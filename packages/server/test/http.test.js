import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockProvider } from '../../shared/src/llm.js';
import { SandboxManager } from '../src/sandbox-manager.js';
import { createApiServer, insertSnippet } from '../src/http.js';

let tmp, server, base, mgr;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-http-'));
  mgr = new SandboxManager({ rootDir: path.join(tmp, 'proj') });
  server = createApiServer({ sandboxManager: mgr, provider: new MockProvider() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await mgr.sandbox().stop().catch(() => {});
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
  try { data = await res.json(); } catch { /* static */ }
  return { status: res.status, data };
};

test('GET /api/files 与 GET/PUT /api/file', async () => {
  let r = await api('/api/files');
  assert.equal(r.status, 200);
  assert.ok(r.data.files.includes('src/App.jsx'));

  r = await api('/api/file?path=src/App.jsx');
  assert.equal(r.status, 200);
  assert.match(r.data.content, /export default function App/);

  r = await api('/api/file?path=README.md', { method: 'PUT', body: { content: '# hi\n' } });
  assert.equal(r.status, 200);
  r = await api('/api/file?path=README.md');
  assert.equal(r.data.content, '# hi\n');

  r = await api('/api/file?path=nope.txt');
  assert.equal(r.status, 404);
});

test('POST /api/generate 生成登录页', async () => {
  const r = await api('/api/generate', { method: 'POST', body: { prompt: '做一个登录页' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.file, 'src/App.jsx');
  assert.match(r.data.code, /登录/);
  assert.match(r.data.code, /data-source-loc=/);
  const f = await api('/api/file?path=src/App.jsx');
  assert.equal(f.data.content, r.data.code);
});

test('POST /api/patch：text/class/style 写文件生效', async () => {
  await api('/api/generate', { method: 'POST', body: { prompt: '做一个登录页' } });
  const { data: f } = await api('/api/file?path=src/App.jsx');
  const loc = /<h2 data-source-loc="([^"]+)"/.exec(f.content)[1];
  // text
  let r = await api('/api/patch', { method: 'POST', body: { loc, type: 'text', value: '欢迎登录' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.content, />欢迎登录<\/h2>/);
  // class
  r = await api('/api/patch', { method: 'POST', body: { loc, type: 'class', value: 'title-x' } });
  assert.match(r.data.content, /className="title-x"/);
  // style
  r = await api('/api/patch', { method: 'POST', body: { loc, type: 'style', value: { color: '#333333' } } });
  // Phase 2 语义：合并进 h2 已有的 style={{ marginTop: '0' }}
  assert.match(r.data.content, /style=\{\{ marginTop: '0' , "color": "#333333" \}\}/);
  // 磁盘上同样生效
  const { data: f2 } = await api('/api/file?path=src/App.jsx');
  assert.match(f2.content, /欢迎登录/);
  // 非法参数
  r = await api('/api/patch', { method: 'POST', body: { loc, type: 'bogus', value: 1 } });
  assert.equal(r.status, 400);
});

test('history：undo/redo 栈行为', async () => {
  // 此时 undo 栈已有：README 写入、2 次 generate、3 次 patch
  let r = await api('/api/history');
  assert.equal(r.data.canUndo, true);
  // undo 撤销最后一次 style patch
  r = await api('/api/history/undo', { method: 'POST' });
  assert.equal(r.status, 200);
  let { data: f } = await api('/api/file?path=src/App.jsx');
  assert.doesNotMatch(f.content, /#333333/);
  // redo 恢复
  r = await api('/api/history/redo', { method: 'POST' });
  assert.equal(r.status, 200);
  ({ data: f } = await api('/api/file?path=src/App.jsx'));
  assert.match(f.content, /#333333/);
  // 连续 undo 到空 → 409
  for (let i = 0; i < 20; i++) await api('/api/history/undo', { method: 'POST' });
  r = await api('/api/history/undo', { method: 'POST' });
  assert.equal(r.status, 409);
  r = await api('/api/history');
  assert.equal(r.data.canUndo, false);
  assert.equal(r.data.canRedo, true);
});

test('sandbox start/status/stop + /preview/ 同源代理', async () => {
  let r = await api('/api/sandbox/start', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.ok(r.data.port > 0);
  r = await api('/api/sandbox/status');
  assert.equal(r.data.running, true);
  // 经代理取 index 外壳
  const idx = await (await fetch(base + '/preview/')).text();
  assert.match(idx, /id="root"/);
  const app = await (await fetch(base + '/preview/src/App.jsx')).text();
  assert.match(app, /render\(h\(App/);
  r = await api('/api/sandbox/stop', { method: 'POST' });
  assert.equal(r.status, 200);
  r = await api('/api/sandbox/status');
  assert.equal(r.data.running, false);
});

test('design-md GET/PUT + registry + templates 端点形状', async () => {
  let r = await api('/api/design-md');
  assert.equal(r.status, 200);
  assert.match(r.data.content, /colors/);
  r = await api('/api/design-md', { method: 'PUT', body: { content: '---\nname: x\n---\n\nbody\n' } });
  assert.equal(r.status, 200);
  r = await api('/api/design-md');
  assert.match(r.data.content, /name: x/);
  r = await api('/api/registry');
  assert.equal(r.data.components.length, 20);
  r = await api('/api/templates');
  assert.equal(r.status, 200);
  assert.equal(r.data.templates.length, 10); // Phase 3 模板库（详细行为见 templates.test.js）
  r = await api('/api/templates/apply', { method: 'POST', body: { id: 'x' } });
  assert.equal(r.status, 404); // 未知 id
});

test('insertSnippet：补 import + 根容器插入', () => {
  const code = `export default function App() {\n  return (\n    <div>\n      <p>hi</p>\n    </div>\n  );\n}\n`;
  const out = insertSnippet(code, '<Button variant="default">新按钮</Button>', { name: 'Button', import: '@/components/ui/button' });
  assert.match(out, /^import \{ Button \} from '@\/components\/ui\/button';\n/);
  assert.match(out, /<p>hi<\/p>\n      <Button variant="default">新按钮<\/Button>\n    <\/div>/);
  // 幂等 import
  const out2 = insertSnippet(out, '<Button>又一个</Button>', { name: 'Button', import: '@/components/ui/button' });
  assert.equal(out2.match(/import \{ Button \}/g).length, 1);
});

test('POST /api/insert 端点', async () => {
  await api('/api/generate', { method: 'POST', body: { prompt: '做一个落地页' } });
  const r = await api('/api/insert', { method: 'POST', body: { name: 'Badge' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.content, /<Badge>标签<\/Badge>/);
  const bad = await api('/api/insert', { method: 'POST', body: { name: 'Nope' } });
  assert.equal(bad.status, 400);
});

test('编辑器静态页可访问', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /draftly|设计|editor/i);
});
