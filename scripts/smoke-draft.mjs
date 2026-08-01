#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApiServer } from '../packages/server/src/http.js';
import { DraftStore } from '../packages/server/src/drafts.js';

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-smoke-'));
const drafts = new DraftStore({ rootDir });
let taskCount = 0;
const provider = {
  async runTask({ cwd, onEvent }) {
    taskCount += 1;
    onEvent?.({ type: 'agent_start' });
    const file = path.join(cwd, 'src/App.tsx');
    const source = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, `${source.trimEnd()}\n// smoke-task-${taskCount}\n`);
    onEvent?.({ type: 'tool_execution_start', toolName: 'edit', toolCallId: `edit-${taskCount}` });
    onEvent?.({ type: 'tool_execution_end', toolName: 'edit', toolCallId: `edit-${taskCount}` });
    onEvent?.({ type: 'agent_end' });
    return `Smoke task ${taskCount}`;
  },
};
const server = createApiServer({ provider, drafts });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

function locatorFor(source) {
  const index = source.indexOf('<h1');
  const before = source.slice(0, index);
  const lines = before.split('\n');
  return {
    file: 'src/App.tsx',
    line: lines.length,
    column: lines.at(-1).length,
    tagName: 'h1',
    text: 'starter heading',
  };
}

async function post(url, body) {
  const response = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${url}: ${data.error || response.status}`);
  return data;
}

let failed = false;
try {
  const generated = await post('/api/drafts/generate', {
    prompt: 'Build a source project',
    variants: 1,
  });
  const id = generated.drafts[0].id;
  const detail = await fetch(`${base}/api/drafts/${id}`).then((response) => response.json());
  if (detail.meta.format !== 'vite-react' || detail.version !== 1) {
    throw new Error('generated draft is not a v1 React source project');
  }

  const preview = await post(`/api/drafts/${id}/preview`, {});
  const previewHtml = await fetch(preview.url).then((response) => response.text());
  const transformedSource = await fetch(new URL('/src/App.tsx', preview.url)).then((response) => response.text());
  if (!previewHtml.includes('id="root"') || !transformedSource.includes('data-locatorjs-id')) {
    throw new Error('managed Vite preview or locator transform is unavailable');
  }

  const edited = await post(`/api/drafts/${id}/edit-source`, {
    instruction: 'Update selected heading',
    locator: locatorFor(detail.source.content),
  });
  if (edited.version !== 2) throw new Error('source edit did not create v2');

  const rolledBack = await post(`/api/drafts/${id}/rollback`, { v: 1 });
  if (rolledBack.version !== 3) throw new Error('rollback did not create v3');

  const exported = await fetch(`${base}/api/drafts/${id}/export`);
  const bytes = new Uint8Array(await exported.arrayBuffer());
  if (exported.status !== 200 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('source ZIP export is invalid');
  }

  console.log('SMOKE PASS: source generation, Vite preview, locator edit, Git rollback, ZIP export');
} catch (error) {
  failed = true;
  console.error(`SMOKE FAIL: ${error.message}`);
} finally {
  await server.previewManager.shutdown();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(rootDir, { recursive: true, force: true });
}

if (failed) process.exitCode = 1;
