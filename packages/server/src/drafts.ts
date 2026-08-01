import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './process.js';
import type {
  CommandRunner,
  DraftMeta,
  DraftVersion,
  ErrorWithStatus,
  ProgressHandler,
} from './types.js';
import { errorWithStatus } from './types.js';

const DEFAULT_TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../draft-template',
);
const COMPONENT_REGISTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../shared/component-registry.json',
);
const DRAFT_ID = /^[a-z0-9][a-z0-9-]*$/;
const TEMPLATE_VERSION = 2;

export class DraftNotFoundError extends Error {
  status = 404;

  constructor(id: unknown) {
    super(`draft not found: ${id}`);
  }
}

export class InvalidDraftPathError extends Error {
  status = 400;

  constructor(file: unknown) {
    super(`invalid draft path: ${file}`);
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

async function copyTemplate(source: string, destination: string): Promise<void> {
  await fs.cp(source, destination, {
    recursive: true,
    filter(file) {
      const relative = path.relative(source, file);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return !['node_modules', 'dist', '.git'].includes(first)
        && !relative.endsWith('.tsbuildinfo');
    },
  });
}

export class DraftStore {
  rootDir: string;
  templateDir: string;
  run: CommandRunner;
  installDependencies: boolean;

  constructor({
    rootDir,
    templateDir = DEFAULT_TEMPLATE_DIR,
    commandRunner = runCommand,
    installDependencies = true,
  }: {
    rootDir: string;
    templateDir?: string;
    commandRunner?: CommandRunner;
    installDependencies?: boolean;
  }) {
    this.rootDir = path.resolve(rootDir);
    this.templateDir = path.resolve(templateDir);
    this.run = commandRunner;
    this.installDependencies = installDependencies;
  }

  _assertId(id: unknown): string {
    if (!DRAFT_ID.test(String(id))) throw new DraftNotFoundError(id);
    return String(id);
  }

  _dir(id: unknown): string {
    return path.join(this.rootDir, this._assertId(id));
  }

  _metaPath(id: unknown): string {
    return path.join(this._dir(id), 'meta.json');
  }

  projectDir(id: unknown): string {
    return path.join(this._dir(id), 'project');
  }

  async list(): Promise<DraftMeta[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.rootDir);
    } catch (error: unknown) {
      const knownError = errorWithStatus(error);
      if (knownError.code === 'ENOENT') return [];
      throw knownError;
    }
    const drafts = [];
    for (const name of names) {
      if (!DRAFT_ID.test(name)) continue;
      try {
        const meta = JSON.parse(await fs.readFile(this._metaPath(name), 'utf8')) as DraftMeta;
        drafts.push(meta.format ? meta : { ...meta, format: 'html-legacy' });
      } catch {
        // Ignore unrelated and incomplete directories.
      }
    }
    return drafts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async createProject({
    prompt,
    designMd = null,
    onProgress,
  }: {
    prompt?: string;
    designMd?: string | null;
    onProgress?: ProgressHandler;
  } = {}): Promise<DraftMeta> {
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const draftDir = this._dir(id);
    const projectDir = this.projectDir(id);
    const meta: DraftMeta = {
      id,
      title: String(prompt || '未命名草稿').replace(/\s+/g, ' ').trim().slice(0, 40) || '未命名草稿',
      prompt: String(prompt || ''),
      format: 'vite-react',
      schemaVersion: 2,
      templateVersion: TEMPLATE_VERSION,
      projectDir: 'project',
      createdAt: new Date().toISOString(),
      versions: [],
    };

    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.mkdir(draftDir);
    try {
      onProgress?.({ type: 'pipeline', stage: 'scaffold_started' });
      await copyTemplate(this.templateDir, projectDir);
      await fs.copyFile(COMPONENT_REGISTRY, path.join(projectDir, 'component-registry.json'));
      if (designMd) await fs.writeFile(path.join(projectDir, 'DESIGN.md'), `${designMd.trim()}\n`);
      await writeJsonAtomic(this._metaPath(id), meta);
      onProgress?.({ type: 'pipeline', stage: 'scaffold_completed' });

      if (this.installDependencies) {
        onProgress?.({ type: 'pipeline', stage: 'dependencies_started' });
        await this.run('npm', ['install', '--no-audit', '--no-fund'], { cwd: projectDir });
        onProgress?.({ type: 'pipeline', stage: 'dependencies_completed' });
      }

      await this.run('git', ['init', '--quiet'], { cwd: projectDir });
      await this.run('git', ['config', 'user.name', 'Draftly'], { cwd: projectDir });
      await this.run('git', ['config', 'user.email', 'draftly@localhost'], { cwd: projectDir });
      await fs.writeFile(
        path.join(projectDir, '.gitignore'),
        'node_modules/\ndist/\n*.tsbuildinfo\n.draftly-input/\n',
      );
      await this.run('git', ['add', '-A'], { cwd: projectDir });
      await this.run('git', ['commit', '--quiet', '-m', 'chore: initialize Draftly project'], { cwd: projectDir });
      return meta;
    } catch (error: unknown) {
      await fs.rm(draftDir, { recursive: true, force: true });
      throw error;
    }
  }

  async remove(id: unknown): Promise<void> {
    await fs.rm(this._dir(id), { recursive: true, force: true });
  }

  async meta(id: unknown): Promise<DraftMeta> {
    try {
      const meta = JSON.parse(await fs.readFile(this._metaPath(id), 'utf8')) as DraftMeta;
      if (meta.format !== 'vite-react') {
        const error = new Error(`legacy HTML draft requires migration: ${id}`) as ErrorWithStatus;
        error.status = 409;
        throw error;
      }
      return meta;
    } catch (error: unknown) {
      const knownError = errorWithStatus(error);
      if (knownError.status) throw knownError;
      throw new DraftNotFoundError(id);
    }
  }

  async head(id: unknown): Promise<string> {
    const { stdout } = await this.run('git', ['rev-parse', 'HEAD'], { cwd: this.projectDir(id) });
    return stdout.trim();
  }

  async assertClean(id: unknown): Promise<void> {
    const { stdout } = await this.run('git', ['status', '--porcelain'], { cwd: this.projectDir(id) });
    if (stdout.trim()) throw new Error(`draft workspace has uncommitted changes: ${id}`);
  }

  async resetTo(id: unknown, commit: string): Promise<void> {
    const cwd = this.projectDir(id);
    await this.run('git', ['reset', '--hard', commit], { cwd });
    await this.run('git', ['clean', '-fd'], { cwd });
  }

  async commitVersion(
    id: unknown,
    {
      kind,
      instruction = null,
      summary = null,
    }: {
      kind: string;
      instruction?: string | null;
      summary?: string | null;
    },
  ): Promise<{ meta: DraftMeta; version: number; commit: string }> {
    const meta = await this.meta(id);
    const cwd = this.projectDir(id);
    await this.run('git', ['add', '-A'], { cwd });
    const { stdout: staged } = await this.run('git', ['diff', '--cached', '--name-only'], { cwd });
    if (!staged.trim()) throw new Error('Pi task completed without changing source files');
    const v = meta.versions.length + 1;
    const message = `${kind === 'generate' ? 'feat' : 'draft'}: ${kind} v${v}`;
    await this.run('git', ['commit', '--quiet', '-m', message], { cwd });
    const commit = await this.head(id);
    meta.versions.push({
      v,
      commit,
      kind,
      instruction,
      summary,
      files: staged.trim().split('\n'),
      at: new Date().toISOString(),
    });
    await writeJsonAtomic(this._metaPath(id), meta);
    return { meta, version: v, commit };
  }

  async runVersionTransaction<T extends { summary?: string | null }>(
    id: unknown,
    details: { kind: string; instruction?: string | null },
    execute: (cwd: string) => Promise<T>,
  ): Promise<{ meta: DraftMeta; version: number; commit: string; outcome: T }> {
    await this.meta(id);
    await this.assertClean(id);
    const before = await this.head(id);
    try {
      const outcome = await execute(this.projectDir(id));
      const committed = await this.commitVersion(id, { ...details, summary: outcome?.summary || null });
      return { ...committed, outcome };
    } catch (error: unknown) {
      await this.resetTo(id, before).catch(() => {});
      throw error;
    }
  }

  async rollbackVersion(
    id: unknown,
    value: string | number,
  ): Promise<{ meta: DraftMeta; version: number; commit: string; outcome: { summary: string } }> {
    const meta = await this.meta(id);
    const target = Number.parseInt(String(value), 10);
    const selected = meta.versions.find((version) => version.v === target);
    if (!selected) throw new DraftNotFoundError(`${id} v${target}`);
    const { stdout: trees } = await this.run(
      'git',
      ['rev-parse', 'HEAD^{tree}', `${selected.commit}^{tree}`],
      { cwd: this.projectDir(id) },
    );
    const [currentTree, targetTree] = trees.trim().split('\n');
    if (currentTree === targetTree) {
      const error = new Error(`draft source already matches v${target}`) as ErrorWithStatus;
      error.status = 409;
      throw error;
    }
    return this.runVersionTransaction(
      id,
      { kind: 'rollback', instruction: `回退到 v${target}` },
      async (cwd) => {
        await this.run('git', ['restore', '--source', selected.commit, '--staged', '--worktree', '.'], { cwd });
        return { summary: `Restored the source tree from v${target}` };
      },
    );
  }

  resolveProjectFile(id: unknown, relativeFile: string): string {
    if (!relativeFile || path.isAbsolute(relativeFile)) throw new InvalidDraftPathError(relativeFile);
    const project = this.projectDir(id);
    const resolved = path.resolve(project, relativeFile);
    if (resolved === project || !resolved.startsWith(`${project}${path.sep}`)) {
      throw new InvalidDraftPathError(relativeFile);
    }
    return resolved;
  }

  async readSource(
    id: unknown,
    relativeFile = 'src/App.tsx',
    version: number | null = null,
  ): Promise<{
    meta: DraftMeta;
    file: string;
    source: string;
    version: number;
  }> {
    const meta = await this.meta(id);
    const normalized = String(relativeFile).replaceAll('\\', '/');
    const absolute = this.resolveProjectFile(id, normalized);
    if (!/\.(?:[cm]?[jt]sx?|css|json|html|md)$/.test(normalized)) {
      throw new InvalidDraftPathError(relativeFile);
    }
    let source;
    if (version == null) {
      const realProject = await fs.realpath(this.projectDir(id));
      const realFile = await fs.realpath(absolute).catch(() => null);
      if (!realFile || !realFile.startsWith(`${realProject}${path.sep}`)) {
        throw new InvalidDraftPathError(relativeFile);
      }
      source = await fs.readFile(realFile, 'utf8');
    } else {
      const selected = meta.versions.find((item) => item.v === Number(version));
      if (!selected) throw new DraftNotFoundError(`${id} v${version}`);
      const { stdout } = await this.run('git', ['show', `${selected.commit}:${normalized}`], {
        cwd: this.projectDir(id),
      });
      source = stdout;
    }
    return { meta, file: normalized, source, version: version ?? meta.versions.length };
  }

  async versionDiff(
    id: unknown,
    value: string | number,
  ): Promise<{ version: DraftVersion; diff: string }> {
    const meta = await this.meta(id);
    const selected = meta.versions.find((item) => item.v === Number(value));
    if (!selected) throw new DraftNotFoundError(`${id} v${value}`);
    const { stdout } = await this.run(
      'git',
      ['show', '--format=fuller', '--stat', '--patch', '--no-ext-diff', selected.commit],
      { cwd: this.projectDir(id) },
    );
    return { version: selected, diff: stdout.slice(0, 200_000) };
  }
}
