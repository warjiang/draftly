/**
 * smoke-phase2.mjs — Phase 2 端到端冒烟（Inspect 编辑闭环）。
 * Task 2.1：inspect 注入 + postMessage 协议解析
 * Task 2.2：AST 精准修改（class 三形态 / style 合并）经 /api/patch 落地
 * Task 2.3：自然语言改元素（/api/nl-edit）→ HMR 刷新 → undo 还原
 * 运行：node scripts/smoke-phase2.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/server/src');
const sharedSrc = path.resolve(serverSrc, '../../shared/src');
const { SandboxManager } = await import(path.join(serverSrc, 'sandbox-manager.js'));
const { createApiServer } = await import(path.join(serverSrc, 'http.js'));
const { MockProvider } = await import(path.join(sharedSrc, 'llm.js'));
const { parseSelectMessage, INSPECT_MSG_SELECT } = await import(path.join(sharedSrc, 'inspect.js'));

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-smoke2-'));
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
  /* ---------- Task 2.1：Inspect ---------- */
  await api('/api/sandbox/start', 'POST');
  const shell = await (await fetch(base + '/preview/')).text();
  assert.match(shell, /<script src="\/__inspect\.js"><\/script>/, '外壳缺 inspect 注入');
  const inspectJs = await (await fetch(base + '/preview/__inspect.js')).text();
  assert.match(inspectJs, /draftly:inspect:select/);
  assert.match(inspectJs, /postMessage/);
  step('Task 2.1: /preview/ 外壳含 inspect 注入，/__inspect.js 可用');

  // 模拟 iframe 端 postMessage 负载 → 编辑器侧解析（协议 schema 校验）
  const mockDomMessage = {
    type: INSPECT_MSG_SELECT,
    payload: {
      loc: 'src/App.jsx:8:10', tagName: 'h2', className: 'title', textContent: '登录',
      computedStyles: { color: 'rgb(46, 46, 44)', fontSize: '24px', fontFamily: 'sans-serif',
        backgroundColor: 'rgba(0, 0, 0, 0)', borderRadius: '0px', padding: '0px', margin: '0px' },
    },
  };
  const parsed = parseSelectMessage(mockDomMessage);
  assert.equal(parsed.loc, 'src/App.jsx:8:10');
  assert.equal(parseSelectMessage({ type: 'evil', payload: {} }), null);
  assert.equal(parseSelectMessage({ type: INSPECT_MSG_SELECT, payload: { loc: 'bad' } }), null);
  step('Task 2.1: postMessage 负载解析（合法通过 / 非法忽略）');

  // 编辑器页面引用协议模块
  const appJs = await (await fetch(base + '/app.js')).text();
  assert.match(appJs, /\/shared\/inspect\.js/);
  step('Task 2.1: 编辑器加载共享协议模块');

  /* ---------- Task 2.2：AST 精准修改经 /api/patch 落地 ---------- */
  const gen = await api('/api/generate', 'POST', { prompt: '做一个登录页' });
  assert.equal(gen.status, 200);
  const before = gen.data.code;
  const h2Loc = /<h2 data-source-loc="([^"]+)"/.exec(before)[1];
  // class：无 className → 新建（字符串形态）
  let r = await api('/api/patch', 'POST', { loc: h2Loc, type: 'class', value: 'title text-2xl' });
  assert.equal(r.status, 200);
  assert.match(r.data.content, /className="title text-2xl"/);
  // style：合并进已有 style={{ marginTop: '0' }}，同名字段覆盖、其余保留
  r = await api('/api/patch', 'POST', { loc: h2Loc, type: 'style', value: { color: '#3f4a5a' } });
  assert.equal(r.status, 200);
  assert.match(r.data.content, /style=\{\{ marginTop: '0' , "color": "#3f4a5a" \}\}/);
  // 格式保留：仅 h2 所在行变化
  const la = before.split('\n'), lb = r.data.content.split('\n');
  assert.equal(la.length, lb.length);
  const changed = la.map((l, i) => (l !== lb[i] ? i + 1 : null)).filter(Boolean);
  assert.deepEqual(changed, [Number(h2Loc.split(':')[1])]);
  step('Task 2.2: /api/patch class 新建 + style 合并 + 格式保留（仅目标行变化）');
  // history 快照：undo 还原两次 patch
  await api('/api/history/undo', 'POST');
  await api('/api/history/undo', 'POST');
  const reverted = await api('/api/file?path=src/App.jsx');
  assert.equal(reverted.data.content, before);
  step('Task 2.2: patch 前 history 快照，undo 逐步还原');

  /* ---------- Task 2.3：自然语言改元素 ---------- */
  const nlLoc = /<h2 data-source-loc="([^"]+)"/.exec(before)[1];
  const nl = await api('/api/nl-edit', 'POST', { loc: nlLoc, instruction: '改成 36px 紫色渐变标题' });
  assert.equal(nl.status, 200, JSON.stringify(nl.data));
  assert.deepEqual(nl.data.applied, ['class']);
  assert.match(nl.data.content, /text-4xl/);
  assert.match(nl.data.content, /bg-gradient-to-r from-purple-500 to-fuchsia-500 bg-clip-text text-transparent/);
  step('Task 2.3: /api/nl-edit「改成 36px 紫色渐变标题」→ text-4xl + 紫色渐变 class');

  // HMR 链路：preview 转译模块即时反映文件变更（watcher → reload 由 iframe 承担）
  const mod = await (await fetch(base + '/preview/src/App.jsx')).text();
  assert.match(mod, /text-4xl/);
  step('Task 2.3: preview 模块已反映变更（HMR-lite 刷新链路可用）');

  // undo 还原
  await api('/api/history/undo', 'POST');
  const afterNlUndo = await api('/api/file?path=src/App.jsx');
  assert.equal(afterNlUndo.data.content, before);
  step('Task 2.3: undo 还原 nl-edit 变更');

  console.log('\nSMOKE PHASE 2: PASS');
  process.exitCode = 0;
} catch (e) {
  console.error('\nSMOKE PHASE 2: FAIL');
  console.error(e);
  process.exitCode = 1;
} finally {
  await mgr.sandbox().stop().catch(() => {});
  server.closeAllConnections?.();
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
