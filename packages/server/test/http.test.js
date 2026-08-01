import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DraftStore } from '../src/drafts.js';
import { createApiServer } from '../src/http.js';

let temporaryRoot;
let server;
let base;

before(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-http-tests-'));
  const editorDir = path.join(temporaryRoot, 'editor');
  await fs.mkdir(editorDir, { recursive: true });
  await fs.writeFile(path.join(editorDir, 'index.html'), '<!doctype html><div id="root"></div>');
  const drafts = new DraftStore({
    rootDir: path.join(temporaryRoot, 'drafts'),
    installDependencies: false,
  });
  server = createApiServer({
    drafts,
    editorDir,
    provider: { runTask: async () => 'unused' },
    previewManager: { ensure: async () => ({}), shutdown: async () => {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

test('serves the Vite editor entry', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /id="root"/);
});

test('serves template details and rejects an unknown template', async () => {
  const list = await fetch(`${base}/api/templates`).then((response) => response.json());
  assert.ok(list.templates.length > 0);
  const detail = await fetch(`${base}/api/templates/${list.templates[0].id}`);
  assert.equal(detail.status, 200);
  assert.ok((await detail.json()).designMd);
  assert.equal((await fetch(`${base}/api/templates/nope`)).status, 404);
});

test('extracts a design offline and validates request bodies', async () => {
  const response = await fetch(`${base}/api/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html: '<button class="primary">Save</button>',
      css: '.primary { color: #2563eb; border-radius: 8px; }',
    }),
  });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).designMd);

  const invalid = await fetch(`${base}/api/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(invalid.status, 400);
  assert.equal((await fetch(`${base}/api/no-such-route`)).status, 404);
});
