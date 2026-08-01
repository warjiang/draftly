import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DraftStore } from '../src/drafts.js';
import {
  editDraftByImage,
  editDraftSource,
  generateDrafts,
  iterateDraft,
} from '../src/draft-generate.js';
import { createApiServer } from '../src/http.js';
import { migrateLegacyDrafts } from '../src/migration.js';
import { runCommand } from '../src/process.js';
import { sourceContextForLocator } from '../src/source-locator.js';

let temporaryRoot;

before(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-source-tests-'));
});

after(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

async function testCommand(command, args, options) {
  if (command === 'npm') return { stdout: '', stderr: '' };
  return runCommand(command, args, options);
}

class FakeWorkspaceExecutor {
  constructor() {
    this.calls = [];
  }

  async runTask({ cwd, instruction, images = [], onEvent }) {
    this.calls.push({ cwd, instruction, images });
    onEvent?.({ type: 'agent_start' });
    onEvent?.({ type: 'tool_execution_start', toolName: 'read', toolCallId: 'read-1' });
    const appFile = path.join(cwd, 'src/App.tsx');
    const source = await fs.readFile(appFile, 'utf8');
    onEvent?.({ type: 'tool_execution_end', toolName: 'read', toolCallId: 'read-1' });
    onEvent?.({ type: 'tool_execution_start', toolName: 'edit', toolCallId: 'edit-1' });
    const marker = `task-${this.calls.length}`;
    await fs.writeFile(appFile, `${source.trimEnd()}\n// ${marker}\n`);
    onEvent?.({ type: 'tool_execution_end', toolName: 'edit', toolCallId: 'edit-1' });
    onEvent?.({ type: 'agent_end' });
    return `Updated src/App.tsx (${marker})`;
  }
}

function createStore(name) {
  return new DraftStore({
    rootDir: path.join(temporaryRoot, name),
    installDependencies: false,
    commandRunner: testCommand,
  });
}

function locatorFor(source, token = '<h1') {
  const index = source.indexOf(token);
  assert.notEqual(index, -1);
  const before = source.slice(0, index);
  const lines = before.split('\n');
  return {
    file: 'src/App.tsx',
    line: lines.length,
    column: lines.at(-1).length,
    tagName: token.slice(1),
    text: 'selected heading',
    styles: { display: 'block' },
  };
}

test('DraftStore creates an isolated React project and commits monotonic Git versions', async () => {
  const store = createStore('store');
  const draft = await store.createProject({ prompt: '做一个产品页' });
  assert.equal(draft.format, 'vite-react');
  assert.equal(draft.schemaVersion, 2);
  assert.equal((await store.meta(draft.id)).versions.length, 0);
  assert.match(await fs.readFile(path.join(store.projectDir(draft.id), 'vite.config.ts'), 'utf8'), /locatorJsx/);

  const first = await store.runVersionTransaction(
    draft.id,
    { kind: 'generate', instruction: 'first' },
    async (cwd) => {
      const file = path.join(cwd, 'src/App.tsx');
      await fs.appendFile(file, '\n// first-version\n');
      return { summary: 'first' };
    },
  );
  const second = await store.runVersionTransaction(
    draft.id,
    { kind: 'iterate', instruction: 'second' },
    async (cwd) => {
      await fs.appendFile(path.join(cwd, 'src/App.tsx'), '// second-version\n');
      return { summary: 'second' };
    },
  );
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.notEqual(first.commit, second.commit);

  const rollback = await store.rollbackVersion(draft.id, 1);
  assert.equal(rollback.version, 3);
  assert.equal(rollback.meta.versions[2].kind, 'rollback');
  const source = await store.readSource(draft.id);
  assert.match(source.source, /first-version/);
  assert.doesNotMatch(source.source, /second-version/);
  assert.equal((await store.meta(draft.id)).versions.length, 3);
  await assert.rejects(() => store.rollbackVersion(draft.id, 1), /already matches v1/);

  const diff = await store.versionDiff(draft.id, 3);
  assert.match(diff.diff, /second-version/);
  await assert.rejects(() => store.readSource(draft.id, '../meta.json'), /invalid draft path/);
  await assert.rejects(() => store.meta('../escape'), /draft not found/);
});

test('source locator resolves selected JSX, imports, and owning component', async () => {
  const store = createStore('locator');
  const draft = await store.createProject({ prompt: 'locator' });
  const source = await store.readSource(draft.id);
  const locator = locatorFor(source.source);
  const context = await sourceContextForLocator({ drafts: store, id: draft.id, locator });
  assert.equal(context.file, 'src/App.tsx');
  assert.equal(context.component, 'App');
  assert.match(context.selectedSource, /^<h1/);
  assert.match(context.context, /import \{ ArrowRight \}/);
  assert.match(context.context, /Owning component/);
});

test('source generation, iteration, locator edit, and image edit create Git versions', async () => {
  const store = createStore('pipeline');
  const executor = new FakeWorkspaceExecutor();
  const events = [];
  const generated = await generateDrafts({
    drafts: store,
    provider: executor,
    prompt: '做一个 SaaS 定价页',
    variants: 2,
    onProgress: (event) => events.push(event),
  });
  assert.equal(generated.drafts.length, 2);
  assert.ok(events.some((event) => event.stage === 'scaffold_started'));
  assert.ok(events.some((event) => event.stage === 'validation_completed'));
  assert.ok(events.some((event) => event.type === 'pi' && event.event.toolName === 'edit'));

  const id = generated.drafts[0].id;
  assert.equal((await store.meta(id)).versions[0].kind, 'generate');
  const iterated = await iterateDraft({
    drafts: store,
    provider: executor,
    id,
    instruction: '改成深色模式',
  });
  assert.equal(iterated.version, 2);

  const source = await store.readSource(id);
  const selected = await editDraftSource({
    drafts: store,
    provider: executor,
    id,
    locator: locatorFor(source.source),
    instruction: '标题更醒目',
  });
  assert.equal(selected.version, 3);
  assert.equal(selected.locator.component, 'App');

  const image = await editDraftByImage({
    drafts: store,
    provider: executor,
    id,
    image: 'data:image/png;base64,iVBORw0KGgo=',
    instruction: '参考截图调整布局',
  });
  assert.equal(image.version, 4);
  assert.equal(executor.calls.at(-1).images.length, 1);
});

test('failed generation removes the incomplete project instead of creating mock output', async () => {
  const store = createStore('failed-generation');
  const executor = {
    async runTask() {
      throw new Error('Pi failed');
    },
  };
  await assert.rejects(
    () => generateDrafts({ drafts: store, provider: executor, prompt: 'x', variants: 1 }),
    /Pi failed/,
  );
  assert.deepEqual(await store.list(), []);
});

test('HTTP source API streams progress, serves preview metadata, exports ZIP, and rolls back by commit', async () => {
  const store = createStore('http');
  const executor = new FakeWorkspaceExecutor();
  const editorDir = path.join(temporaryRoot, 'editor');
  await fs.mkdir(editorDir, { recursive: true });
  await fs.writeFile(path.join(editorDir, 'index.html'), '<div id="root"></div>');
  const previewManager = {
    async ensure() {
      return { url: 'http://127.0.0.1:59999/', token: 'preview-token', status: 'ready' };
    },
    async shutdown() {},
  };
  const server = createApiServer({
    provider: executor,
    drafts: store,
    editorDir,
    previewManager,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    const response = await post('/api/drafts/generate?stream=1', {
      prompt: '生成仪表盘',
      variants: 1,
    });
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    const messages = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.ok(messages.some((message) => message.type === 'progress'));
    const id = messages.find((message) => message.type === 'result').data.drafts[0].id;

    const detail = await fetch(`${base}/api/drafts/${id}`).then((item) => item.json());
    assert.equal(detail.version, 1);
    assert.equal(detail.source.file, 'src/App.tsx');
    const preview = await post(`/api/drafts/${id}/preview`, {}).then((item) => item.json());
    assert.equal(preview.token, 'preview-token');

    const source = await fetch(`${base}/api/drafts/${id}/source?file=src%2FApp.tsx`).then((item) => item.json());
    const locator = locatorFor(source.source);
    const edited = await post(`/api/drafts/${id}/edit-source`, {
      locator,
      instruction: '修改标题',
    }).then((item) => item.json());
    assert.equal(edited.version, 2);

    const rolledBack = await post(`/api/drafts/${id}/rollback`, { v: 1 }).then((item) => item.json());
    assert.equal(rolledBack.version, 3);
    const diff = await fetch(`${base}/api/drafts/${id}/versions/3/diff`).then((item) => item.json());
    assert.equal(diff.version.kind, 'rollback');

    const exported = await fetch(`${base}/api/drafts/${id}/export`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /application\/zip/);
    assert.match(exported.headers.get('content-disposition'), new RegExp(`${id}-v3\\.zip`));
    const bytes = new Uint8Array(await exported.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('legacy migration is idempotent, preserves backups, and creates a React Git project', async () => {
  const rootDir = path.join(temporaryRoot, 'migration');
  const id = 'legacy-draft';
  const directory = path.join(rootDir, id);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'meta.json'), JSON.stringify({
    id,
    title: 'Legacy',
    prompt: '旧页面',
    createdAt: '2025-01-01T00:00:00.000Z',
    versions: [{ v: 1, kind: 'generate' }],
  }));
  await fs.writeFile(path.join(directory, 'v1.html'), '<!doctype html><h1>旧页面</h1>');

  const executor = new FakeWorkspaceExecutor();
  const first = await migrateLegacyDrafts({
    rootDir,
    provider: executor,
    installDependencies: false,
    commandRunner: testCommand,
  });
  assert.equal(first[0].status, 'migrated');
  const meta = JSON.parse(await fs.readFile(path.join(directory, 'meta.json'), 'utf8'));
  assert.equal(meta.format, 'vite-react');
  assert.equal(meta.migration.status, 'completed');
  assert.equal(meta.versions[0].kind, 'migration');
  assert.match(await fs.readFile(path.join(directory, 'legacy-backup/v1.html'), 'utf8'), /旧页面/);
  await fs.access(path.join(directory, 'project/.git'));

  const second = await migrateLegacyDrafts({
    rootDir,
    provider: executor,
    installDependencies: false,
    commandRunner: testCommand,
  });
  assert.equal(second[0].status, 'skipped');
});
