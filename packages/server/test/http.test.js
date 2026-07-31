/**
 * http.test.js - HTTP API 层补充测试（HTML 草稿模式 M1-M4）
 * 草稿生成/迭代/点选/回退/导出/模板列表的端到端集成见 drafts.test.js；
 * 本文件覆盖 drafts.test.js 未触及的端点：静态根、模板详情、设计提取、404。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockProvider } from '../../shared/src/llm.js';
import { DraftStore } from '../src/drafts.js';
import { createApiServer } from '../src/http.js';

let tmp, server, base;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-http-'));
  const drafts = new DraftStore({ rootDir: path.join(tmp, 'drafts') });
  server = createApiServer({ provider: new MockProvider(), drafts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await fs.rm(tmp, { recursive: true, force: true });
});

const api = async (p, opts = {}) => {
  const res = await fetch(base + p, opts.method ? {
    method: opts.method,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  } : undefined);
  let data = null;
  try { data = await res.json(); } catch { /* 静态响应非 JSON */ }
  return { status: res.status, data, res };
};

test('静态根 / 返回 drafts.html（新编辑器入口）', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /drafts-app\.js/);
  assert.match(html, /设计草稿|draftly/i);
});

test('GET /api/templates/:id 详情；未知 id 404', async () => {
  const list = await api('/api/templates');
  const id = list.data.templates[0].id;
  const r = await api(`/api/templates/${id}`);
  assert.equal(r.status, 200);
  assert.ok(r.data.designMd);
  const missing = await api('/api/templates/nope');
  assert.equal(missing.status, 404);
});

test('POST /api/extract {html, css} 离线设计提取；空体 400', async () => {
  const r = await api('/api/extract', {
    method: 'POST',
    body: {
      html: '<div class="btn">x</div>',
      css: '.btn { color: #3b82f6; border-radius: 8px; }',
    },
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.designMd);
  const bad = await api('/api/extract', { method: 'POST', body: {} });
  assert.equal(bad.status, 400);
});

test('未知 API 端点 404', async () => {
  const r = await api('/api/no-such-endpoint');
  assert.equal(r.status, 404);
});
