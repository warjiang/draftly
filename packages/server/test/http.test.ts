import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DraftStore } from '../src/drafts.js';
import { createApiApp } from '../src/http.js';

let temporaryRoot: string;
let app: ReturnType<typeof createApiApp>['app'];

before(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-http-tests-'));
  const editorDir = path.join(temporaryRoot, 'editor');
  await fs.mkdir(editorDir, { recursive: true });
  await fs.writeFile(path.join(editorDir, 'index.html'), '<!doctype html><div id="root"></div>');
  const drafts = new DraftStore({
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
  assert.ok((await detail.json() as { designMd?: string }).designMd);
  assert.equal((await app.request('/api/templates/nope')).status, 404);
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
