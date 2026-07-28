/**
 * smoke-phase1.mjs — Phase 1 端到端冒烟：
 * 启动 API server + sandbox → 生成登录页 → 读取文件 → preview 取渲染模块 →
 * patch 文案 → undo → redo → 断言全流程通过。
 * 运行：node scripts/smoke-phase1.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/server/src');
const { SandboxManager } = await import(path.join(serverSrc, 'sandbox-manager.js'));
const { createApiServer } = await import(path.join(serverSrc, 'http.js'));
const { MockProvider } = await import(path.join(serverSrc, '../../shared/src/llm.js'));

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-smoke-'));
const mgr = new SandboxManager({ rootDir: path.join(tmp, 'proj') });
const server = createApiServer({ sandboxManager: mgr, provider: new MockProvider() });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (p, method, body) => {
  const res = await fetch(base + p, method ? {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  } : undefined);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};

const step = (name) => console.log(`  ✓ ${name}`);

try {
  // 1. 启动 sandbox
  const st = await api('/api/sandbox/start', 'POST');
  assert.equal(st.status, 200);
  assert.ok(st.data.port > 0);
  step(`sandbox started on :${st.data.port}`);

  // 2. 生成登录页
  const gen = await api('/api/generate', 'POST', { prompt: '做一个登录页' });
  assert.equal(gen.status, 200);
  assert.match(gen.data.code, /登录/);
  assert.match(gen.data.code, /data-source-loc="src\/App\.jsx:\d+:\d+"/);
  step('generate 登录页 → src/App.jsx（含 data-source-loc）');

  // 3. 读取文件
  const file = await api('/api/file?path=src/App.jsx');
  assert.equal(file.data.content, gen.data.code);
  step('GET /api/file 读回一致');

  // 4. preview 取渲染模块 + 外壳
  const idx = await (await fetch(base + '/preview/')).text();
  assert.match(idx, /id="root"/);
  const mod = await (await fetch(base + '/preview/src/App.jsx')).text();
  assert.match(mod, /h\(Card/);
  assert.match(mod, /"data-source-loc"/);
  assert.match(mod, /render\(h\(App/);
  const btnMod = await (await fetch(base + '/preview/components/ui/button.js')).text();
  assert.match(btnMod, /export function Button/);
  step('preview 同源代理：外壳/转译模块/内置组件均可取');

  // 5. patch 文案
  const loc = /<h2 data-source-loc="([^"]+)"/.exec(file.data.content)[1];
  const patched = await api('/api/patch', 'POST', { loc, type: 'text', value: '冒烟登录' });
  assert.equal(patched.status, 200);
  assert.match(patched.data.content, />冒烟登录<\/h2>/);
  step(`patch text @ ${loc} → "冒烟登录"`);

  // 6. undo → 文案还原
  const undo = await api('/api/history/undo', 'POST');
  assert.equal(undo.status, 200);
  const afterUndo = await api('/api/file?path=src/App.jsx');
  assert.doesNotMatch(afterUndo.data.content, /冒烟登录/);
  step('undo → 文案还原');

  // 7. redo → 文案恢复
  const redo = await api('/api/history/redo', 'POST');
  assert.equal(redo.status, 200);
  const afterRedo = await api('/api/file?path=src/App.jsx');
  assert.match(afterRedo.data.content, /冒烟登录/);
  step('redo → 文案恢复');

  // 8. 编辑器静态页
  const editorHtml = await (await fetch(base + '/')).text();
  assert.match(editorHtml, /draftly/);
  step('编辑器 SPA 可访问');

  // 9. 停 sandbox
  await api('/api/sandbox/stop', 'POST');
  const status = await api('/api/sandbox/status');
  assert.equal(status.data.running, false);
  step('sandbox stopped');

  console.log('\nSMOKE PHASE 1: PASS');
  process.exitCode = 0;
} catch (e) {
  console.error('\nSMOKE PHASE 1: FAIL');
  console.error(e);
  process.exitCode = 1;
} finally {
  await mgr.sandbox().stop().catch(() => {});
  server.closeAllConnections?.();
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
