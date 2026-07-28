/**
 * drafts.test.js — M1 HTML 草稿：后处理 / 存储 / 生成管线 / HTTP API
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockProvider, DRAFT_PROMPT_MARKER } from '../../shared/src/llm.js';
import { defaultDesignMd } from '../../shared/src/design-md.js';
import { DraftStore } from '../src/drafts.js';
import { extractHtml, sanitizeHtml, injectDataIds, postProcessHtml } from '../src/html-post.js';
import { buildDraftPrompt } from '../src/draft-prompts.js';
import { generateDrafts } from '../src/draft-generate.js';
import { SandboxManager } from '../src/sandbox-manager.js';
import { createApiServer } from '../src/http.js';

let tmp;
before(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-draft-')); });
after(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

/* ---------- extractHtml ---------- */

test('extractHtml：围栏 / 裸文档 / 杂谈容错 / 无 HTML 报错', () => {
  const fenced = extractHtml('好的！\n```html\n<!doctype html>\n<html><body>hi</body></html>\n```\n希望有用');
  assert.ok(fenced.startsWith('<!doctype html>'));
  assert.match(fenced, /<body>hi<\/body>/);

  const raw = extractHtml('<!doctype html>\n<html><body>x</body></html>\n以上是草稿。');
  assert.ok(raw.endsWith('</html>'));
  assert.doesNotMatch(raw, /以上是草稿/);

  // 无围栏时直接以 <html 开头也接受
  assert.match(extractHtml('<html><body>y</body></html>'), /<body>y<\/body>/);

  assert.throws(() => extractHtml('没有 HTML 的文字'), /未找到 HTML/);
  assert.throws(() => extractHtml(''), /返回为空/);
});

/* ---------- sanitizeHtml ---------- */

test('sanitizeHtml：去 script / on* / javascript: 链接', () => {
  const dirty = '<div onclick="alert(1)">a</div><script>evil()</script>'
    + '<a href="javascript:evil()">x</a><img src="ok.png" onerror=\'boom()\'>';
  const clean = sanitizeHtml(dirty);
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onclick/i);
  assert.doesNotMatch(clean, /onerror/i);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.match(clean, /src="ok\.png"/); // 正常属性保留
});

/* ---------- injectDataIds ---------- */

test('injectDataIds：body 内注入自增 data-did，骨架/样式跳过，幂等', () => {
  const html = '<!doctype html><html><head><style>.a{}</style></head>'
    + '<body><main><h1>t</h1><p data-did="keep">x</p><img src="a.png"><button>b</button></main></body></html>';
  const out = injectDataIds(html);
  assert.match(out, /<main data-did="1">/);
  assert.match(out, /<h1 data-did="2">/);
  assert.match(out, /<p data-did="keep">/);            // 已有 did 保留
  assert.doesNotMatch(out, /<img[^>]*data-did/);        // void 元素跳过
  assert.match(out, /<button data-did="3">/);
  assert.doesNotMatch(out, /<style[^>]*data-did/);      // head 内不注入
  assert.doesNotMatch(out, /<body[^>]*data-did/);       // 骨架不注入
  assert.equal(injectDataIds('<div>no body</div>'), '<div>no body</div>');
});

/* ---------- buildDraftPrompt ---------- */

test('buildDraftPrompt：含草稿标记与设计契约', () => {
  const msgs = buildDraftPrompt({ userPrompt: '做一个定价页', designMd: defaultDesignMd() });
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs[0].content.includes(DRAFT_PROMPT_MARKER));
  assert.match(msgs[0].content, /<!doctype html>/);
  assert.match(msgs[0].content, /#3f4a5a/); // DESIGN.md primary 注入
  assert.equal(msgs[1].content, '做一个定价页');

  const bare = buildDraftPrompt({ userPrompt: 'x' });
  assert.doesNotMatch(bare[0].content, /DESIGN\.md，草稿/);
});

/* ---------- MockProvider 草稿模式 ---------- */

test('MockProvider：草稿标记 → 确定性整页 HTML，可过后处理管线', async () => {
  const provider = new MockProvider();
  const msgs = buildDraftPrompt({ userPrompt: '做一个登录页', designMd: defaultDesignMd() });
  const raw = await provider.complete(msgs);
  const html = postProcessHtml(raw);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /欢迎回来/);
  assert.match(html, /data-did="\d+"/);
  // 相同输入相同输出
  assert.equal(await provider.complete(msgs), raw);
});

/* ---------- DraftStore ---------- */

test('DraftStore：create / saveVersion / list / readHtml / 404', async () => {
  const store = new DraftStore({ rootDir: path.join(tmp, 'drafts') });
  const meta = await store.create({ prompt: '做一个 深色 定价页 ' });
  assert.equal(meta.title, '做一个 深色 定价页'); // 空白折叠 + trim
  assert.ok(meta.id);

  const { v: v1 } = await store.saveVersion(meta.id, '<html>v1</html>');
  const { v: v2 } = await store.saveVersion(meta.id, '<html>v2</html>', { kind: 'iterate', instruction: '改导航' });
  assert.equal(v1, 1);
  assert.equal(v2, 2);

  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].versions.length, 2);
  assert.equal(list[0].versions[1].instruction, '改导航');

  const latest = await store.readHtml(meta.id);
  assert.equal(latest.version, 2);
  assert.equal(latest.html, '<html>v2</html>');
  const first = await store.readHtml(meta.id, 1);
  assert.equal(first.html, '<html>v1</html>');

  await assert.rejects(() => store.readHtml(meta.id, 9), /draft not found/);
  await assert.rejects(() => store.meta('nope'), /draft not found/);

  // 空目录 / 不存在目录 → 空列表
  const empty = new DraftStore({ rootDir: path.join(tmp, 'no-such-dir') });
  assert.deepEqual(await empty.list(), []);
});

/* ---------- generateDrafts ---------- */

test('generateDrafts：Mock 多变体落盘，variants 收敛到 1-3', async () => {
  const store = new DraftStore({ rootDir: path.join(tmp, 'gen-drafts') });
  const r = await generateDrafts({
    drafts: store, provider: new MockProvider(), prompt: '做一个落地页', variants: 3,
  });
  assert.equal(r.drafts.length, 3);
  for (const d of r.drafts) {
    const { html, version } = await store.readHtml(d.id);
    assert.equal(version, 1);
    assert.match(html, /用 AI 加速你的界面设计/);
  }
  // variants 超界收敛
  const r2 = await generateDrafts({ drafts: store, provider: new MockProvider(), prompt: 'x', variants: 99 });
  assert.equal(r2.drafts.length, 3);
  const r3 = await generateDrafts({ drafts: store, provider: new MockProvider(), prompt: 'x', variants: 0 });
  assert.equal(r3.drafts.length, 1);
});

/* ---------- HTTP API 集成 ---------- */

test('HTTP：/api/draft/generate → /api/drafts → /api/draft/:id', async () => {
  const mgr = new SandboxManager({ rootDir: path.join(tmp, 'sandbox') });
  const drafts = new DraftStore({ rootDir: path.join(tmp, 'api-drafts') });
  const server = createApiServer({ sandboxManager: mgr, provider: new MockProvider(), drafts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, method, body) => {
    const res = await fetch(base + p, method ? {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    } : undefined);
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    const bad = await call('/api/draft/generate', 'POST', {});
    assert.equal(bad.status, 400);

    const gen = await call('/api/draft/generate', 'POST', { prompt: '做一个仪表盘', variants: 2 });
    assert.equal(gen.status, 200);
    assert.equal(gen.data.drafts.length, 2);

    const list = await call('/api/drafts');
    assert.equal(list.status, 200);
    assert.ok(list.data.drafts.length >= 2);

    const id = gen.data.drafts[0].id;
    const one = await call(`/api/draft/${id}`);
    assert.equal(one.status, 200);
    assert.match(one.data.html, /仪表盘/);
    assert.equal(one.data.version, 1);
    assert.match(one.data.html, /data-did=/);

    const missing = await call('/api/draft/no-such-id');
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
