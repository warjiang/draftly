import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { and, desc, eq } from 'drizzle-orm';
import type postgres from 'postgres';
import type { Database } from './db/client.js';
import { withAdvisoryLock } from './db/locks.js';
import { draftVersions, drafts, storedObjects } from './db/schema.js';
import { DatabaseProjectStore } from './db-projects.js';
import { DraftNotFoundError, DraftStore } from './drafts.js';
import type { WorkspaceManager } from './storage/workspace-manager.js';
import type { DraftMeta, DraftVersion, ProgressHandler } from './types.js';

function metadata(
  draft: typeof drafts.$inferSelect,
  versions: Array<typeof draftVersions.$inferSelect>,
): DraftMeta {
  return {
    id: draft.id,
    projectId: draft.projectId,
    title: draft.title,
    prompt: draft.prompt,
    format: draft.format,
    schemaVersion: draft.schemaVersion,
    templateVersion: draft.templateVersion,
    projectDir: 'project',
    createdAt: draft.createdAt.toISOString(),
    versions: versions.map((version): DraftVersion => ({
      v: version.version,
      commit: version.commit,
      kind: version.kind,
      instruction: version.instruction,
      summary: version.summary,
      files: version.files,
      at: version.createdAt.toISOString(),
    })),
  };
}

export class PersistentDraftStore extends DraftStore {
  readonly db: Database;
  readonly sql: postgres.Sql;
  readonly workspaces: WorkspaceManager;
  readonly access: DatabaseProjectStore;
  private writing = new Set<string>();

  constructor({
    database,
    sql,
    workspaces,
    access,
    ...options
  }: ConstructorParameters<typeof DraftStore>[0] & {
    database: Database;
    sql: postgres.Sql;
    workspaces: WorkspaceManager;
    access: DatabaseProjectStore;
  }) {
    super({ ...options, rootDir: workspaces.rootDir });
    this.db = database;
    this.sql = sql;
    this.workspaces = workspaces;
    this.access = access;
  }

  override async list(): Promise<DraftMeta[]> {
    const projects = await this.access.list();
    const result: DraftMeta[] = [];
    for (const project of projects) {
      for (const id of project.draftIds) result.push(await this.loadMeta(id, false));
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  override async createProject({
    prompt,
    designMd = null,
    onProgress,
    projectId,
  }: {
    prompt?: string;
    designMd?: string | null;
    onProgress?: ProgressHandler;
    projectId?: string;
  } = {}): Promise<DraftMeta> {
    if (!projectId) throw new Error('projectId required for persistent draft');
    await this.access.role(projectId, 'editor');
    const local = await super.createProject({ prompt, designMd, onProgress });
    const now = new Date(local.createdAt);
    try {
      const snapshot = await this.workspaces.snapshot(
        local.id,
        `drafts/${local.id}/${crypto.randomUUID()}.tgz`,
      );
      await this.db.transaction(async (transaction) => {
        await transaction.insert(drafts).values({
          id: local.id,
          projectId,
          title: local.title,
          prompt: local.prompt,
          format: local.format,
          schemaVersion: local.schemaVersion,
          templateVersion: local.templateVersion,
          objectKey: snapshot.key,
          objectEtag: snapshot.etag,
          objectChecksum: snapshot.checksum,
          objectSize: snapshot.size,
          objectStatus: 'ready',
          createdAt: now,
          updatedAt: now,
        });
        await transaction.insert(storedObjects).values({
          key: snapshot.key,
          draftId: local.id,
          etag: snapshot.etag,
          checksum: snapshot.checksum,
          size: snapshot.size,
        });
      });
      return { ...local, projectId };
    } catch (error) {
      await super.remove(local.id);
      throw error;
    }
  }

  override async remove(id: unknown): Promise<void> {
    const draftId = this._assertId(id);
    await this.access.roleForDraft(draftId, 'editor');
    const [draft] = await this.db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
    if (!draft) return;
    if (draft.objectKey) await this.workspaces.objects.delete(draft.objectKey);
    await this.db.delete(drafts).where(eq(drafts.id, draftId));
    await this.workspaces.remove(draftId);
  }

  override async meta(id: unknown): Promise<DraftMeta> {
    const draftId = this._assertId(id);
    await this.access.roleForDraft(draftId, this.writing.has(draftId) ? 'editor' : 'viewer');
    return this.loadMeta(draftId, true);
  }

  override async setProjectId(id: unknown, projectId: string): Promise<DraftMeta> {
    const draftId = this._assertId(id);
    await this.access.role(projectId, 'editor');
    await this.db.update(drafts).set({ projectId, updatedAt: new Date() }).where(eq(drafts.id, draftId));
    return this.meta(draftId);
  }

  override async commitVersion(
    id: unknown,
    options: {
      kind: string;
      instruction?: string | null;
      summary?: string | null;
    },
  ) {
    const draftId = this._assertId(id);
    const result = await super.commitVersion(draftId, options);
    const version = result.meta.versions.at(-1)!;
    const snapshot = await this.workspaces.snapshot(
      draftId,
      `drafts/${draftId}/${crypto.randomUUID()}.tgz`,
    );
    const [current] = await this.db.select({ objectKey: drafts.objectKey })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .limit(1);
    await this.db.transaction(async (transaction) => {
      await transaction.insert(draftVersions).values({
        id: crypto.randomUUID(),
        draftId,
        version: version.v,
        commit: version.commit,
        kind: version.kind,
        instruction: version.instruction,
        summary: version.summary,
        files: version.files,
        createdAt: new Date(version.at),
      });
      await transaction.insert(storedObjects).values({
        key: snapshot.key,
        draftId,
        etag: snapshot.etag,
        checksum: snapshot.checksum,
        size: snapshot.size,
      });
      await transaction.update(drafts).set({
        objectKey: snapshot.key,
        objectEtag: snapshot.etag,
        objectChecksum: snapshot.checksum,
        objectSize: snapshot.size,
        objectStatus: 'ready',
        updatedAt: new Date(),
      }).where(eq(drafts.id, draftId));
    });
    if (current?.objectKey) {
      await this.workspaces.objects.delete(current.objectKey);
      await this.db.delete(storedObjects).where(eq(storedObjects.key, current.objectKey));
    }
    return result;
  }

  override async runVersionTransaction<T extends { summary?: string | null }>(
    id: unknown,
    version: { kind: string; instruction?: string | null },
    execute: (cwd: string) => Promise<T>,
  ) {
    const draftId = this._assertId(id);
    return withAdvisoryLock(this.sql, `draft:${draftId}`, async () => {
      this.writing.add(draftId);
      try {
        return await super.runVersionTransaction(draftId, version, execute);
      } finally {
        this.writing.delete(draftId);
      }
    });
  }

  private async loadMeta(id: string, restore: boolean): Promise<DraftMeta> {
    const [draft] = await this.db.select().from(drafts).where(eq(drafts.id, id)).limit(1);
    if (!draft) throw new DraftNotFoundError(id);
    const versions = await this.db.select().from(draftVersions)
      .where(eq(draftVersions.draftId, id))
      .orderBy(desc(draftVersions.version));
    const meta = metadata(draft, versions.reverse());
    if (restore) {
      if (!draft.objectKey || !draft.objectChecksum) throw new Error(`draft snapshot unavailable: ${id}`);
      await this.workspaces.ensure(id, {
        key: draft.objectKey,
        checksum: draft.objectChecksum,
      });
      await this.ensureProjectDependencies(id);
      await fs.writeFile(this._metaPath(id), `${JSON.stringify(meta, null, 2)}\n`);
    }
    return meta;
  }
}
