/**
 * smoke-phase3.mjs — Phase 3 端到端冒烟（设计系统层）。
 * Task 3.2：/api/extract 离线路径（html+css fixture → designMd/tokens/tailwindCss）
 *           + url 路径无网络 → 501 + 引导
 * Task 3.3：模板库列表 → apply「Stripe」→ 生成页面使用 Stripe 配色 → undo 还原
 * 运行：node scripts/smoke-phase3.mjs
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
const { parseDesignMd, validateDesignMd } = await import(path.join(sharedSrc, 'design-md.js'));

const FIX = path.resolve(serverSrc, '../test/fixtures');
const fixCss = await fs.readFile(path.join(FIX, 'linear-ish.css'), 'utf8');
const fixHtml = await fs.readFile(path.join(FIX, 'linear-ish.html'), 'utf8');

const near = (hex, target, tol = 40) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const t = [1, 3, 5].map((i) => parseInt(target.slice(i, i + 2), 16));
  return v.every((c, i) => Math.abs(c - t[i]) <= tol);
};

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-smoke3-'));
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
  /* ---------- Task 3.2：设计提取（离线核心路径） ---------- */
  const ext = await api('/api/extract', 'POST', { html: fixHtml, css: fixCss });
  assert.equal(ext.status, 200, JSON.stringify(ext.data));
  const { designMd, tokens, tailwindCss } = ext.data;
  assert.deepEqual(validateDesignMd(designMd), []);
  const { meta } = parseDesignMd(designMd);
  assert.ok(near(meta.colors.primary, '#5e6ad2'), `primary=${meta.colors.primary}`);
  assert.ok(['4px', '8px'].includes(tokens.spacing.unit), `spacing=${tokens.spacing.unit}`);
  assert.ok(Array.isArray(tokens.colors) && tokens.colors.length >= 4);
  assert.match(tailwindCss, /@theme/);
  assert.match(tailwindCss, /--color-primary: #[0-9a-f]{6};/);
  step('Task 3.2: /api/extract {html,css} → designMd 主色≈#5e6ad2 + tokens/tailwindCss 结构合法');

  const bad = await api('/api/extract', 'POST', {});
  assert.equal(bad.status, 400);
  step('Task 3.2: 空请求 → 400 参数校验');

  const urlTry = await api('/api/extract', 'POST', { url: 'http://169.254.169.254/never' });
  if (urlTry.status === 501) {
    assert.match(urlTry.data.hint, /html, css/);
    step('Task 3.2: 无网络 url 路径 → 501 + 引导粘贴 HTML（离线环境符合预期）');
  } else {
    assert.equal(urlTry.status, 200); // 有网环境：fetch 成功亦可
    step('Task 3.2: url 路径有网络 → 200（增强路径可用）');
  }

  /* ---------- Task 3.3：模板库全流程 ---------- */
  const list = await api('/api/templates');
  assert.equal(list.status, 200);
  assert.equal(list.data.templates.length, 10);
  const stripeSum = list.data.templates.find((t) => t.id === 'stripe');
  assert.equal(stripeSum.colors.primary, '#635bff');
  assert.equal(stripeSum.confidence, 'curated');
  assert.ok(!('designMd' in stripeSum)); // 列表摘要不含全文
  step('Task 3.3: GET /api/templates → 10 个预置模板（摘要含色板）');

  const detail = await api('/api/templates/linear');
  assert.equal(detail.status, 200);
  assert.match(detail.data.designMd, /#5e6ad2/);
  step('Task 3.3: GET /api/templates/:id → 含 designMd 全文');

  const dmdBefore = (await api('/api/design-md')).data.content;
  const apply = await api('/api/templates/apply', 'POST', { id: 'stripe' });
  assert.equal(apply.status, 200, JSON.stringify(apply.data));
  const dmdAfter = (await api('/api/design-md')).data.content;
  assert.match(dmdAfter, /#635bff/);
  assert.notEqual(dmdAfter, dmdBefore);
  step('Task 3.3: apply「Stripe」→ sandbox DESIGN.md 切换为 Stripe 主题');

  const gen = await api('/api/generate', 'POST', { prompt: '做一个落地页' });
  assert.equal(gen.status, 200);
  assert.match(gen.data.code, /design-tokens: primary=#635bff/);
  assert.match(gen.data.code, /background: '#635bff'/);
  step('Task 3.3: apply 后生成页面使用 Stripe 配色（#635bff 确定性映射）');

  await api('/api/history/undo', 'POST'); // undo generate
  await api('/api/history/undo', 'POST'); // undo apply
  const dmdUndo = (await api('/api/design-md')).data.content;
  assert.equal(dmdUndo, dmdBefore);
  step('Task 3.3: undo 还原 DESIGN.md（模板应用可撤销）');

  console.log('\nSMOKE PHASE 3: PASS');
  process.exitCode = 0;
} catch (e) {
  console.error('\nSMOKE PHASE 3: FAIL');
  console.error(e);
  process.exitCode = 1;
} finally {
  await mgr.sandbox().stop().catch(() => {});
  server.closeAllConnections?.();
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
