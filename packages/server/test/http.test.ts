import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultDesignMd } from '../../shared/src/design-md.js';
import { DraftStore } from '../src/drafts.js';
import { createApiApp } from '../src/http.js';

let temporaryRoot: string;
let app: ReturnType<typeof createApiApp>['app'];
let drafts: DraftStore;

before(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-http-tests-'));
  const editorDir = path.join(temporaryRoot, 'editor');
  await fs.mkdir(editorDir, { recursive: true });
  await fs.writeFile(path.join(editorDir, 'index.html'), '<!doctype html><div id="root"></div>');
  drafts = new DraftStore({
    rootDir: path.join(temporaryRoot, 'drafts'),
    installDependencies: false,
  });
  ({ app } = createApiApp({
    drafts,
    editorDir,
    provider: { runTask: async () => 'unused' },
    previewManager: {
      ensure: async () => ({ url: 'http://127.0.0.1/', token: 'test', status: 'ready' }),
      shutdown: async () => {},
    },
  }));
});

after(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

test('serves the Vite editor entry', async () => {
  const response = await app.request('/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /id="root"/);
});

test('serves template details and rejects an unknown template', async () => {
  const listResponse = await app.request('/api/templates');
  const list = await listResponse.json() as { templates: Array<{ id: string }> };
  assert.ok(list.templates.length > 0);
  const detail = await app.request(`/api/templates/${list.templates[0].id}`);
  assert.equal(detail.status, 200);
  const template = await detail.json() as {
    designMd?: string;
    meta?: { colors?: { primary?: string } };
  };
  assert.ok(template.designMd);
  assert.match(template.meta?.colors?.primary ?? '', /^#[0-9a-f]{6}$/);
  assert.equal((await app.request('/api/templates/nope')).status, 404);
});

test('serves an optional parsed DESIGN.md for drafts', async () => {
  const withDesign = await drafts.createProject({
    prompt: 'With design',
    designMd: defaultDesignMd({ name: 'preview-test' }),
  });
  const designResponse = await app.request(`/api/drafts/${withDesign.id}/design`);
  assert.equal(designResponse.status, 200);
  const design = await designResponse.json() as {
    content: string | null;
    meta: { name?: string } | null;
  };
  assert.match(design.content ?? '', /preview-test/);
  assert.equal(design.meta?.name, 'preview-test');

  const withoutDesign = await drafts.createProject({ prompt: 'Without design' });
  const emptyResponse = await app.request(`/api/drafts/${withoutDesign.id}/design`);
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual(await emptyResponse.json(), { content: null, meta: null });
  const filesResponse = await app.request(`/api/drafts/${withoutDesign.id}/files`);
  assert.equal(filesResponse.status, 200);
  const files = await filesResponse.json() as {
    files: Array<{ path: string; name: string; size: number }>;
  };
  assert.ok(files.files.some((file) => (
    file.path === 'src/App.tsx'
    && file.name === 'App.tsx'
    && file.size > 0
  )));
  assert.equal((await app.request('/api/drafts/not-found/design')).status, 404);
  assert.equal((await app.request('/api/drafts/not-found/files')).status, 404);
});

test('extracts a design offline and validates request bodies', async () => {
  const response = await app.request('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html: '<button class="primary">Save</button>',
      css: '.primary { color: #2563eb; border-radius: 8px; }',
    }),
  });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).designMd);

  const invalid = await app.request('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(invalid.status, 400);
  assert.equal((await app.request('/api/no-such-route')).status, 404);
});

test('rejects API request bodies larger than 10 MB', async () => {
  const response = await app.request('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: 'x'.repeat(10_000_001) }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'body too large' });
});
