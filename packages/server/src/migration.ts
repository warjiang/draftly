import fs from 'node:fs/promises';
import path from 'node:path';
import { buildGenerateInstruction } from './draft-prompts.js';
import { DraftStore } from './drafts.js';
import { runCommand } from './process.js';
import { assertNoEscapingSymlinks } from './source-locator.js';
import type {
  CommandRunner,
  DraftMeta,
  ProgressEvent,
  ProgressHandler,
  WorkspaceProvider,
} from './types.js';
import { errorWithStatus } from './types.js';

type LegacyVersionFile = {
  name: string;
  match: RegExpExecArray;
};

type LegacyMeta = Partial<DraftMeta> & {
  id?: string;
  title?: string;
  prompt?: string;
  createdAt?: string;
};

export type MigrationResult =
  | { id: string; status: 'skipped' }
  | { id: string; status: 'migrated'; version: number }
  | { id: string; status: 'failed'; error: string };

async function legacyVersionFiles(directory: string): Promise<LegacyVersionFile[]> {
  const names = await fs.readdir(directory);
  return names
    .map((name) => ({ name, match: /^v(\d+)\.html$/.exec(name) }))
    .filter((item): item is LegacyVersionFile => item.match !== null)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
}

async function recordFailure(
  metaPath: string,
  meta: LegacyMeta,
  error: Error,
): Promise<void> {
  const next = {
    ...meta,
    migration: {
      status: 'failed',
      attemptedAt: new Date().toISOString(),
      error: error.message,
    },
  };
  await fs.writeFile(metaPath, `${JSON.stringify(next, null, 2)}\n`);
}

async function migrateOne({
  rootDir,
  id,
  provider,
  templateDir,
  installDependencies,
  commandRunner,
  onProgress,
}: {
  rootDir: string;
  id: string;
  provider: WorkspaceProvider;
  templateDir?: string;
  installDependencies: boolean;
  commandRunner: CommandRunner;
  onProgress?: ProgressHandler;
}): Promise<MigrationResult> {
  const legacyDir = path.join(rootDir, id);
  const metaPath = path.join(legacyDir, 'meta.json');
  const legacyMeta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as LegacyMeta;
  if (legacyMeta.format === 'vite-react') return { id, status: 'skipped' };
  const versions = await legacyVersionFiles(legacyDir);
  if (!versions.length) throw new Error(`legacy draft has no HTML versions: ${id}`);
  const latest = versions.at(-1)!;
  const html = await fs.readFile(path.join(legacyDir, latest.name), 'utf8');
  const stagingRoot = path.join(rootDir, '.migration-work');
  const staging = new DraftStore({
    rootDir: stagingRoot,
    templateDir,
    installDependencies,
    commandRunner,
  });
  const stagedMeta = await staging.createProject({
    prompt: legacyMeta.prompt || `Migrate legacy draft ${id}`,
    onProgress,
  });
  const inputDir = path.join(staging.projectDir(stagedMeta.id), '.draftly-input');
  await fs.mkdir(inputDir, { recursive: true });
  await fs.writeFile(path.join(inputDir, 'legacy.html'), html);

  try {
    const result = await staging.runVersionTransaction(
      stagedMeta.id,
      {
        kind: 'migration',
        instruction: `Migrate legacy HTML ${latest.name}`,
      },
      async (cwd) => {
        const summary = await provider.runTask({
          cwd,
          instruction: [
            buildGenerateInstruction({
              userPrompt: legacyMeta.prompt || legacyMeta.title || 'Recreate this interface',
              variant: 1,
            }),
            'This is a legacy migration. Read .draftly-input/legacy.html and faithfully recreate its',
            'content and visual design as maintainable React and TypeScript source. Do not import or',
            'render the legacy HTML file at runtime.',
          ].join('\n\n'),
          onEvent: (event) => onProgress?.({ type: 'pi', event }),
        });
        await assertNoEscapingSymlinks(cwd);
        await commandRunner('npm', ['run', 'build'], { cwd });
        return { summary };
      },
    );
    await fs.rm(inputDir, { recursive: true, force: true });

    const backupDir = path.join(legacyDir, 'legacy-backup');
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(metaPath, path.join(backupDir, 'meta.json'));
    for (const version of versions) {
      await fs.copyFile(
        path.join(legacyDir, version.name),
        path.join(backupDir, version.name),
      );
    }
    await fs.rename(staging.projectDir(stagedMeta.id), path.join(legacyDir, 'project'));
    const migratedMeta = {
      ...result.meta,
      id,
      title: legacyMeta.title || result.meta.title,
      prompt: legacyMeta.prompt || result.meta.prompt,
      createdAt: legacyMeta.createdAt || result.meta.createdAt,
      migration: {
        status: 'completed',
        migratedAt: new Date().toISOString(),
        sourceVersion: Number(latest.match[1]),
        legacyBackup: 'legacy-backup',
      },
    };
    await fs.writeFile(metaPath, `${JSON.stringify(migratedMeta, null, 2)}\n`);
    for (const version of versions) {
      await fs.rm(path.join(legacyDir, version.name));
    }
    await staging.remove(stagedMeta.id);
    return { id, status: 'migrated', version: result.version };
  } catch (error: unknown) {
    const knownError = errorWithStatus(error);
    await staging.remove(stagedMeta.id).catch(() => {});
    await recordFailure(metaPath, legacyMeta, knownError);
    throw knownError;
  }
}

export async function migrateLegacyDrafts({
  rootDir,
  provider,
  templateDir,
  installDependencies = true,
  commandRunner = runCommand,
  onProgress,
}: {
  rootDir: string;
  provider: WorkspaceProvider;
  templateDir?: string;
  installDependencies?: boolean;
  commandRunner?: CommandRunner;
  onProgress?: (event: ProgressEvent & { id: string }) => void;
}): Promise<MigrationResult[]> {
  if (!provider?.runTask) throw new Error('Pi workspace executor is required for migration');
  const absoluteRoot = path.resolve(rootDir);
  let entries = [];
  try {
    entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  } catch (error: unknown) {
    const knownError = errorWithStatus(error);
    if (knownError.code === 'ENOENT') return [];
    throw knownError;
  }
  const results: MigrationResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) continue;
    try {
      const result = await migrateOne({
        rootDir: absoluteRoot,
        id: entry.name,
        provider,
        templateDir,
        installDependencies,
        commandRunner,
        onProgress: (event) => onProgress?.({ id: entry.name, ...event }),
      });
      results.push(result);
    } catch (error: unknown) {
      results.push({
        id: entry.name,
        status: 'failed',
        error: errorWithStatus(error).message,
      });
    }
  }
  await fs.rm(path.join(absoluteRoot, '.migration-work'), { recursive: true, force: true });
  return results;
}
