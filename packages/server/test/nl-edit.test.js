/**
 * nl-edit.test.js — Phase 2 Task 2.3：自然语言改元素。
 * - MockProvider 编辑指令映射确定性
 * - buildEditPrompt / parseEditOutput
 * - editElement 端到端：生成登录页 → 选中标题 loc → 指令 → 文件断言 → undo 还原
 * - POST /api/nl-edit 端点
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockProvider, EDIT_PROMPT_MARKER } from '../../shared/src/llm.js';
import { ProjectSandbox } from '../src/sandbox.js';
import { FileHistory } from '../src/history.js';
import { SandboxManager } from '../src/sandbox-manager.js';
import { createApiServer } from '../src/http.js';
import { generatePage } from '../src/generate.js';
import { buildEditPrompt, parseEditOutput, editElement, extractElementCode } from '../src/nl-edit.js';

/* ---------- Mock 指令映射确定性 ---------- */
test('Mock 编辑映射：确定性（同输入同输出）', async () => {
  const p = new MockProvider();
  const msgs = [
    { role: 'system', content: `${EDIT_PROMPT_MARKER} 上下文` },
    { role: 'user', content: '改成 36px 紫色渐变标题' },
  ];
  const a = await p.complete(msgs);
  const b = await p.complete(msgs);
  assert.equal(a, b);
  const parsed = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(a)[1]);
  assert.match(parsed.class, /text-4xl/);
  assert.match(parsed.class, /bg-gradient-to-r/);
  assert.match(parsed.class, /from-purple-500/);
});

test('Mock 编辑映射：关键词表覆盖', async () => {
  const p = new MockProvider();
  const edit = async (instruction) => {
    const raw = await p.complete([
      { role: 'system', content: EDIT_PROMPT_MARKER },
      { role: 'user', content: instruction },
    ]);
    return JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)[1]);
  };
  assert.equal((await edit('字体调大')).class, 'text-2xl');
  assert.equal((await edit('改成圆角')).class, 'rounded-xl');
  assert.equal((await edit('改成红色')).class, 'text-red-500');
  assert.equal((await edit('背景改成红色')).class, 'bg-red-500');
  assert.equal((await edit('全圆角加粗')).class, 'rounded-full font-bold');
  assert.deepEqual(await edit('随便说点什么'), {}); // 无匹配 → 空对象
});

/* ---------- prompt / 输出解析 ---------- */
test('buildEditPrompt：包含标记、元素代码与指令', () => {
  const msgs = buildEditPrompt({ elementCode: '<h1 className="t">Hi</h1>', designMd: null, instruction: '调大' });
  assert.equal(msgs.length, 2);
  assert.ok(msgs[0].content.includes(EDIT_PROMPT_MARKER));
  assert.ok(msgs[0].content.includes('<h1 className="t">Hi</h1>'));
  assert.equal(msgs[1].content, '调大');
  assert.throws(() => buildEditPrompt({ instruction: 'x' }), /elementCode/);
});

test('parseEditOutput：json 围栏 / 裸 JSON / 裸 class 字符串', () => {
  assert.deepEqual(parseEditOutput('```json\n{"class": "a b"}\n```'), { class: 'a b' });
  assert.deepEqual(parseEditOutput('{"class":"x","text":"你好","style":{"color":"red"}}'),
    { class: 'x', text: '你好', style: { color: 'red' } });
  assert.deepEqual(parseEditOutput('text-lg font-bold'), { class: 'text-lg font-bold' });
  assert.deepEqual(parseEditOutput(''), {});
  assert.deepEqual(parseEditOutput('{"class": ""}'), {}); // 空 class 视为无变更
});

/* ---------- editElement 端到端 ---------- */
let tmp, sbx, history, provider;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-nledit-'));
  sbx = new ProjectSandbox({ rootDir: path.join(tmp, 'proj') });
  await sbx.create();
  history = new FileHistory(sbx);
  provider = new MockProvider();
});

after(async () => {
  await sbx.stop().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true });
});

test('editElement 端到端：登录页标题 → 36px 紫色渐变 → undo 还原', async () => {
  const gen = await generatePage({ sandbox: sbx, provider, userPrompt: '做一个登录页' });
  const before = gen.code;
  const loc = /<h2 data-source-loc="([^"]+)"/.exec(before)[1];

  // extractElementCode 上下文提取
  const snippet = extractElementCode(before, loc);
  assert.match(snippet, /<h2/);

  const r = await editElement({
    sandbox: sbx, provider, loc, instruction: '改成 36px 紫色渐变标题', history,
  });
  assert.equal(r.file, 'src/App.jsx');
  assert.deepEqual(r.applied, ['class']);
  assert.match(r.content, /text-4xl/);
  assert.match(r.content, /bg-gradient-to-r from-purple-500 to-fuchsia-500 bg-clip-text text-transparent/);
  // 落盘
  const onDisk = await sbx.readFile('src/App.jsx');
  assert.equal(onDisk, r.content);
  // history 快照 → undo 还原
  const undone = await history.undo();
  assert.equal(undone.file, 'src/App.jsx');
  assert.equal(await sbx.readFile('src/App.jsx'), before);
  // redo 恢复（供后续用例处于已编辑状态亦可，这里再 undo 回到基线）
  await history.redo();
  assert.match(await sbx.readFile('src/App.jsx'), /text-4xl/);
  await history.undo();
});

test('editElement：无匹配指令 → unchanged 且不入 history', async () => {
  const loc = /<h2 data-source-loc="([^"]+)"/.exec(await sbx.readFile('src/App.jsx'))[1];
  const depth = history.undoStack.length;
  const r = await editElement({ sandbox: sbx, provider, loc, instruction: '呜啦啦啦', history });
  assert.equal(r.unchanged, true);
  assert.equal(history.undoStack.length, depth);
});

/* ---------- /api/nl-edit 端点 ---------- */
test('POST /api/nl-edit：端到端 + 参数校验', async () => {
  const mgr = new SandboxManager({ rootDir: path.join(tmp, 'api-proj') });
  const server = createApiServer({ sandboxManager: mgr, provider: new MockProvider() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, body) => {
    const res = await fetch(base + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    await api('/api/generate', { prompt: '做一个登录页' });
    const fileRes = await fetch(base + '/api/file?path=src/App.jsx');
    const { content } = await fileRes.json();
    const loc = /<h2 data-source-loc="([^"]+)"/.exec(content)[1];

    const bad = await api('/api/nl-edit', { loc });
    assert.equal(bad.status, 400);
    const r = await api('/api/nl-edit', { loc, instruction: '改成红色' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.content, /className="text-red-500"/);
    // undo 经 history 生效
    const undo = await api('/api/history/undo');
    assert.equal(undo.status, 200);
    const after = await (await fetch(base + '/api/file?path=src/App.jsx')).json();
    assert.doesNotMatch(after.content, /text-red-500/);
    // loc 无效 → 422
    const badLoc = await api('/api/nl-edit', { loc: 'src/App.jsx:99:1', instruction: '改成红色' });
    assert.equal(badLoc.status, 422);
  } finally {
    await mgr.sandbox().stop().catch(() => {});
    server.closeAllConnections?.();
    server.close();
  }
});
