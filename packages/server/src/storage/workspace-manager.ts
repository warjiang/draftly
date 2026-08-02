import crypto from 'node:crypto';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import type { ReadEntry } from 'tar';
import type { ObjectMetadata, ObjectStore } from './object-store.js';

const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]*$/;
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'dist', '.draftly-input']);
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_FILES = 50_000;
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;
const MARKER_FILE = '.draftly-snapshot.json';

type SnapshotMarker = {
  key: string;
  checksum: string;
};

export type WorkspaceSnapshot = ObjectMetadata;

function assertWorkspaceId(id: string): string {
  if (!WORKSPACE_ID.test(id)) throw new Error(`invalid workspace id: ${id}`);
  return id;
}

function assertArchivePath(entryPath: string): void {
  const normalized = entryPath.replaceAll('\\', '/');
  if (
    normalized.startsWith('/')
    || normalized.split('/').some((segment) => segment === '..')
    || path.posix.normalize(normalized).startsWith('../')
  ) {
    throw new Error(`unsafe archive path: ${entryPath}`);
  }
}

function isLink(entry: ReadEntry | Stats): boolean {
  return 'type' in entry
    ? entry.type === 'SymbolicLink' || entry.type === 'Link'
    : entry.isSymbolicLink();
}

function shouldPack(entryPath: string, entry: ReadEntry | Stats): boolean {
  const normalized = entryPath.replaceAll('\\', '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false;
  if (normalized.endsWith('.tsbuildinfo') || normalized === MARKER_FILE) return false;
  return !isLink(entry);
}

async function removeIfExists(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

export class WorkspaceManager {
  readonly rootDir: string;
  readonly objects: ObjectStore;
  readonly maxArchiveBytes: number;
  private operations = new Map<string, Promise<unknown>>();

  constructor({
    rootDir,
    objects,
    maxArchiveBytes = MAX_ARCHIVE_BYTES,
  }: {
    rootDir: string;
    objects: ObjectStore;
    maxArchiveBytes?: number;
  }) {
    this.rootDir = path.resolve(rootDir);
    this.objects = objects;
    this.maxArchiveBytes = maxArchiveBytes;
  }

  directory(id: string): string {
    return path.join(this.rootDir, assertWorkspaceId(id));
  }

  async createEmpty(id: string): Promise<string> {
    return this.serial(id, async () => {
      const directory = this.directory(id);
      await fs.mkdir(this.rootDir, { recursive: true });
      await removeIfExists(directory);
      await fs.mkdir(directory);
      return directory;
    });
  }

  async ensure(id: string, marker: SnapshotMarker): Promise<string> {
    return this.serial(id, async () => {
      const directory = this.directory(id);
      if (await this.matchesMarker(directory, marker)) return directory;

      const body = await this.objects.get(marker.key);
      if (body.byteLength > this.maxArchiveBytes) {
        throw new Error(`workspace archive exceeds ${this.maxArchiveBytes} bytes`);
      }
      const checksum = crypto.createHash('sha256').update(body).digest('hex');
      if (checksum !== marker.checksum) throw new Error(`workspace checksum mismatch: ${id}`);

      await fs.mkdir(this.rootDir, { recursive: true });
      const staging = await fs.mkdtemp(path.join(this.rootDir, '.restore-'));
      const archive = path.join(staging, 'workspace.tgz');
      const extracted = path.join(staging, 'workspace');
      await fs.mkdir(extracted);
      try {
        await fs.writeFile(archive, body);
        await this.validateArchive(archive);
        await tar.x({
          file: archive,
          cwd: extracted,
          gzip: true,
          strict: true,
          preservePaths: false,
          filter(entryPath, entry) {
            assertArchivePath(entryPath);
            return !isLink(entry);
          },
        });
        await fs.writeFile(
          path.join(extracted, MARKER_FILE),
          `${JSON.stringify(marker)}\n`,
          { flag: 'wx' },
        );
        await removeIfExists(directory);
        await fs.rename(extracted, directory);
      } finally {
        await removeIfExists(staging);
      }
      return directory;
    });
  }

  async snapshot(id: string, key: string): Promise<WorkspaceSnapshot> {
    return this.serial(id, async () => {
      const directory = this.directory(id);
      const staging = await fs.mkdtemp(path.join(this.rootDir, '.snapshot-'));
      const archive = path.join(staging, 'workspace.tgz');
      try {
        await tar.c({
          file: archive,
          sync: false,
          cwd: directory,
          gzip: true,
          portable: true,
          noMtime: true,
          strict: true,
          filter: shouldPack,
        }, ['.']);
        const body = await fs.readFile(archive);
        if (body.byteLength > this.maxArchiveBytes) {
          throw new Error(`workspace archive exceeds ${this.maxArchiveBytes} bytes`);
        }
        const checksum = crypto.createHash('sha256').update(body).digest('hex');
        const result = await this.objects.put(key, body, checksum);
        await fs.writeFile(
          path.join(directory, MARKER_FILE),
          `${JSON.stringify({ key: result.key, checksum: result.checksum })}\n`,
        );
        return result;
      } finally {
        await removeIfExists(staging);
      }
    });
  }

  async remove(id: string): Promise<void> {
    await this.serial(id, () => removeIfExists(this.directory(id)));
  }

  async cleanup(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.rootDir);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await Promise.all(entries.map((entry) => removeIfExists(path.join(this.rootDir, entry))));
  }

  private async matchesMarker(directory: string, expected: SnapshotMarker): Promise<boolean> {
    try {
      const marker = JSON.parse(
        await fs.readFile(path.join(directory, MARKER_FILE), 'utf8'),
      ) as SnapshotMarker;
      return marker.key === expected.key && marker.checksum === expected.checksum;
    } catch {
      return false;
    }
  }

  private async validateArchive(archive: string): Promise<void> {
    let files = 0;
    let unpackedBytes = 0;
    let validationError: Error | null = null;
    await tar.t({
      file: archive,
      gzip: true,
      strict: true,
      onReadEntry(entry) {
        try {
          assertArchivePath(entry.path);
          if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
            throw new Error(`archive links are not allowed: ${entry.path}`);
          }
          files += 1;
          unpackedBytes += entry.size;
          if (files > MAX_FILES) throw new Error(`archive exceeds ${MAX_FILES} files`);
          if (unpackedBytes > MAX_UNPACKED_BYTES) {
            throw new Error(`archive expands beyond ${MAX_UNPACKED_BYTES} bytes`);
          }
        } catch (error: unknown) {
          validationError ??= error instanceof Error ? error : new Error(String(error));
        }
      },
    });
    if (validationError) throw validationError;
  }

  private async serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    assertWorkspaceId(id);
    const previous = this.operations.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.operations.set(id, current);
    try {
      return await current;
    } finally {
      if (this.operations.get(id) === current) this.operations.delete(id);
    }
  }
}
