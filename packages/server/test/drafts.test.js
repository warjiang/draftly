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
import { generateDrafts, iterateDraft, editDraftElement, editDraftByImage } from '../src/draft-generate.js';
import {
  findElementRange, extractElementHtml, replaceElementHtml,
  maxDataDid, ensureRootDid, extractElementFragment,
} from '../src/html-edit.js';
import { buildEditElementPrompt } from '../src/draft-prompts.js';
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

/* ---------- iterateDraft ---------- */

test('iterateDraft：基于当前版本生成 v2，记录 instruction', async () => {
  const store = new DraftStore({ rootDir: path.join(tmp, 'iterate-drafts') });
  const { drafts: created } = await generateDrafts({
    drafts: store, provider: new MockProvider(), prompt: '做一个落地页', variants: 1,
  });
  const id = created[0].id;
  const r = await iterateDraft({ drafts: store, provider: new MockProvider(), id, instruction: '改成深色模式' });
  assert.equal(r.version, 2);
  const latest = await store.readHtml(id);
  assert.equal(latest.version, 2);
  assert.match(latest.html, /m2-iterated/);
  assert.equal(latest.meta.versions[1].kind, 'iterate');
  assert.equal(latest.meta.versions[1].instruction, '改成深色模式');
});

/* ---------- rollbackVersion ---------- */

test('rollbackVersion：删除目标版本之后的文件并截断历史', async () => {
  const store = new DraftStore({ rootDir: path.join(tmp, 'rollback-drafts') });
  const meta = await store.create({ prompt: 'x' });
  await store.saveVersion(meta.id, '<html>v1</html>');
  await store.saveVersion(meta.id, '<html>v2</html>');
  await store.saveVersion(meta.id, '<html>v3</html>');
  const { version } = await store.rollbackVersion(meta.id, 1);
  assert.equal(version, 1);
  const after = await store.readHtml(meta.id);
  assert.equal(after.version, 1);
  assert.equal(after.html, '<html>v1</html>');
  assert.equal(after.meta.versions.length, 1);
  await assert.rejects(() => store.readHtml(meta.id, 2), /draft not found/);
  await assert.rejects(() => store.rollbackVersion(meta.id, 9), /draft not found/);
});

/* ---------- html-edit（M3） ---------- */

test('findElementRange：定位 / 嵌套同名标签 / 找不到', () => {
  const html = '<!doctype html><html><body>'
    + '<div data-did="1"><div data-did="2"><div>inner</div></div><span data-did="3">s</span></div>'
    + '<button data-did="4">b</button></body></html>';
  const r2 = findElementRange(html, 2);
  assert.equal(html.slice(r2.start, r2.end), '<div data-did="2"><div>inner</div></div>');
  const r1 = findElementRange(html, 1);
  assert.ok(html.slice(r1.start, r1.end).includes('<span data-did="3">s</span>')); // 外层含全部子树
  assert.equal(findElementRange(html, 99), null);
});

test('extract / replace / maxDataDid / ensureRootDid / extractElementFragment', () => {
  const html = '<body><p data-did="1">a</p><p data-did="2">b</p></body>';
  assert.equal(extractElementHtml(html, 1), '<p data-did="1">a</p>');
  assert.equal(
    replaceElementHtml(html, 1, '<p data-did="1">A</p>'),
    '<body><p data-did="1">A</p><p data-did="2">b</p></body>',
  );
  assert.equal(replaceElementHtml(html, 9, '<p>x</p>'), null);
  assert.equal(maxDataDid(html), 2);
  assert.equal(maxDataDid('<p>none</p>'), 0);
  // ensureRootDid：缺失补回 / 已有不动 / 自闭合
  assert.equal(ensureRootDid('<button class="x">b</button>', 7), '<button class="x" data-did="7">b</button>');
  assert.equal(ensureRootDid('<button data-did="3">b</button>', 7), '<button data-did="3">b</button>');
  // extractElementFragment：围栏与杂谈容错
  assert.equal(
    extractElementFragment('好的\n```html\n<div>x</div>\n```\n完毕'),
    '<div>x</div>',
  );
  assert.throws(() => extractElementFragment('没有标签'), /未找到元素/);
});

test('buildEditElementPrompt：含标记、元素与指令', () => {
  const msgs = buildEditElementPrompt({ elementHtml: '<button data-did="3">b</button>', instruction: '换成描边样式' });
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /元素局部编辑模式/);
  assert.match(msgs[0].content, /data-did/);
  assert.match(msgs[1].content, /<button data-did="3">/);
  assert.match(msgs[1].content, /换成描边样式/);
});

test('MockProvider 元素编辑：描边指令 → 根标签注入内联样式且保留 data-did', async () => {
  const provider = new MockProvider();
  const msgs = buildEditElementPrompt({ elementHtml: '<button data-did="3" class="btn">b</button>', instruction: '换成描边样式' });
  const out = await provider.complete(msgs);
  assert.match(out, /data-did="3"/);
  assert.match(out, /border: 2px solid/);
  assert.equal(await provider.complete(msgs), out); // 确定性
});

test('editDraftElement：局部替换存新版本，根 did 保留、新元素 did 不冲突', async () => {
  const store = new DraftStore({ rootDir: path.join(tmp, 'edit-element-drafts') });
  const { drafts: created } = await generateDrafts({
    drafts: store, provider: new MockProvider(), prompt: '做一个落地页', variants: 1,
  });
  const id = created[0].id;
  const { html: v1html } = await store.readHtml(id);
  const did = /data-did="(\d+)"/.exec(v1html)[1];
  const r = await editDraftElement({
    drafts: store, provider: new MockProvider(), id, did, instruction: '换成描边样式',
  });
  assert.equal(r.version, 2);
  const { html, meta } = await store.readHtml(id);
  assert.match(html, /border: 2px solid/);
  assert.equal(meta.versions[1].kind, 'edit-element');
  assert.equal(meta.versions[1].instruction, '换成描边样式');
  // did 唯一性：替换后全文 data-did 无重复
  const dids = [...html.matchAll(/data-did="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(dids).size, dids.length);
  await assert.rejects(
    () => editDraftElement({ drafts: store, provider: new MockProvider(), id, did: 999, instruction: 'x' }),
    /element not found/,
  );
});

/* ---------- HTTP API 集成 ---------- */

test('HTTP：/api/draft/generate → /api/drafts → /api/draft/:id', async () => {
  const drafts = new DraftStore({ rootDir: path.join(tmp, 'api-drafts') });
  const server = createApiServer({ provider: new MockProvider(), drafts });
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

    // M2：iterate / rollback
    const iterBad = await call(`/api/draft/${id}/iterate`, 'POST', {});
    assert.equal(iterBad.status, 400);

    const iter = await call(`/api/draft/${id}/iterate`, 'POST', { instruction: '标题改一下' });
    assert.equal(iter.status, 200);
    assert.equal(iter.data.version, 2);

    const afterIter = await call(`/api/draft/${id}`);
    assert.equal(afterIter.data.version, 2);

    const rollbackBad = await call(`/api/draft/${id}/rollback`, 'POST', {});
    assert.equal(rollbackBad.status, 400);

    const rollback = await call(`/api/draft/${id}/rollback`, 'POST', { v: 1 });
    assert.equal(rollback.status, 200);
    assert.equal(rollback.data.version, 1);

    const afterRollback = await call(`/api/draft/${id}`);
    assert.equal(afterRollback.data.version, 1);
    assert.equal(afterRollback.data.meta.versions.length, 1);

    // M3：edit-element
    const eeBad1 = await call(`/api/draft/${id}/edit-element`, 'POST', { instruction: 'x' });
    assert.equal(eeBad1.status, 400);
    const eeBad2 = await call(`/api/draft/${id}/edit-element`, 'POST', { did: 1 });
    assert.equal(eeBad2.status, 400);
    const ee404 = await call(`/api/draft/${id}/edit-element`, 'POST', { did: 999, instruction: 'x' });
    assert.equal(ee404.status, 404);

    const oneMore = await call(`/api/draft/${id}`);
    const did = /data-did="(\d+)"/.exec(oneMore.data.html)[1];
    const ee = await call(`/api/draft/${id}/edit-element`, 'POST', { did, instruction: '换成描边样式' });
    assert.equal(ee.status, 200);
    assert.equal(ee.data.version, 2);
    const afterEe = await call(`/api/draft/${id}`);
    assert.equal(afterEe.data.version, 2);
    assert.match(afterEe.data.html, /border: 2px solid/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

/* ---------- M4：风格预设 + 导出 ---------- */

test('HTTP M4：style 预设注入设计契约；unknown style 400；export 下载/404', async () => {
  const drafts = new DraftStore({ rootDir: path.join(tmp, 'api-drafts-m4') });
  const server = createApiServer({ provider: new MockProvider(), drafts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, body) => {
    const res = await fetch(base + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    // 模板列表驱动前端风格下拉
    const tplRes = await fetch(`${base}/api/templates`);
    assert.equal(tplRes.status, 200);
    const { templates } = await tplRes.json();
    assert.ok(templates.length > 0);
    assert.ok(templates.every((t) => t.id && t.name));

    // unknown style → 400
    const badStyle = await post('/api/draft/generate', { prompt: '做一个定价页', style: 'no-such-style' });
    assert.equal(badStyle.status, 400);
    assert.match(badStyle.data.error, /unknown style/);

    // 合法 style（取模板库第一个）→ 200，正常落盘
    const ok = await post('/api/draft/generate', { prompt: '做一个定价页', style: templates[0].id, variants: 2 });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.drafts.length, 2);

    // export：最新版本整页下载
    const id = ok.data.drafts[0].id;
    const exp = await fetch(`${base}/api/draft/${id}/export`);
    assert.equal(exp.status, 200);
    assert.match(exp.headers.get('content-type'), /text\/html/);
    assert.match(exp.headers.get('content-disposition'), new RegExp(`attachment; filename="draftly-${id}-v1\\.html"`));
    const html = await exp.text();
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /data-did=/);

    // export 不存在的草稿 → 404
    const missing = await fetch(`${base}/api/draft/no-such-id/export`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('generateDrafts M4：多变体部分失败容错（allSettled）；全部失败抛第一个错误', async () => {
  const mock = new MockProvider();
  let n = 0;
  const flaky = {
    complete: (messages, opts) => (++n === 2 ? Promise.reject(new Error('gateway 500')) : mock.complete(messages, opts)),
  };
  const store = new DraftStore({ rootDir: path.join(tmp, 'partial-ok') });
  const r = await generateDrafts({ drafts: store, provider: flaky, prompt: '做一个落地页', variants: 3 });
  assert.equal(r.drafts.length, 2); // 3 个里失败 1 个，成功 2 个

  const alwaysFail = { complete: () => Promise.reject(new Error('always down')) };
  const store2 = new DraftStore({ rootDir: path.join(tmp, 'partial-fail') });
  await assert.rejects(
    () => generateDrafts({ drafts: store2, provider: alwaysFail, prompt: 'x', variants: 2 }),
    /always down/,
  );
});

/* ---------- 截图修改（M5） ---------- */

test('editDraftByImage：截图修改存新版本，kind=edit-by-image', async () => {
  const store = new DraftStore({ rootDir: path.join(tmp, 'edit-by-image-drafts') });
  const { drafts: created } = await generateDrafts({
    drafts: store, provider: new MockProvider(), prompt: '做一个落地页', variants: 1,
  });
  const id = created[0].id;
  const r = await editDraftByImage({
    drafts: store, provider: new MockProvider(), id,
    image: 'data:image/png;base64,iVBORw0KGgo=',
    instruction: '改成深色模式',
  });
  assert.equal(r.version, 2);
  const { html, meta } = await store.readHtml(id);
  assert.match(html, /m-img-edit/);
  assert.equal(meta.versions[1].kind, 'edit-by-image');
  assert.equal(meta.versions[1].instruction, '改成深色模式');
  await assert.rejects(
    () => editDraftByImage({ drafts: store, provider: new MockProvider(), id, image: '', instruction: 'x' }),
    /image required/,
  );
});

test('HTTP M5：/api/draft/:id/edit-by-image 截图修改 -> 新版本；缺图/缺指令 400', async () => {
  const drafts = new DraftStore({ rootDir: path.join(tmp, 'api-img-drafts') });
  const server = createApiServer({ provider: new MockProvider(), drafts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, body) => {
    const res = await fetch(base + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    const gen = await post('/api/draft/generate', { prompt: '做一个落地页', variants: 1 });
    const id = gen.data.drafts[0].id;

    const bad1 = await post(`/api/draft/${id}/edit-by-image`, { instruction: 'x' });
    assert.equal(bad1.status, 400);
    const bad2 = await post(`/api/draft/${id}/edit-by-image`, { image: 'data:image/png;base64,xx' });
    assert.equal(bad2.status, 400);

    const r = await post(`/api/draft/${id}/edit-by-image`, {
      image: 'data:image/png;base64,iVBORw0KGgo=',
      instruction: '改成深色模式',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.version, 2);
    const after = await fetch(`${base}/api/draft/${id}`).then((x) => x.json());
    assert.match(after.html, /m-img-edit/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
