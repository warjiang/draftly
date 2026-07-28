/**
 * inspect.test.js — Phase 2 Task 2.1：inspect 注入脚本与消息协议。
 * - index.html 外壳包含 /__inspect.js 注入点
 * - preview-server 实际 serve 完整 inspect 脚本（hover/click/postMessage/协议常量）
 * - shared/inspect.js 协议 schema 校验函数行为
 * - http.js 暴露 /shared/inspect.js 供编辑器 import
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { INDEX_HTML, INSPECT_SOURCE } from '../src/preview-runtime.js';
import { createPreviewServer } from '../src/preview-server.js';
import { SandboxManager } from '../src/sandbox-manager.js';
import { createApiServer } from '../src/http.js';
import { MockProvider } from '../../shared/src/llm.js';
import {
  INSPECT_MSG_SET, INSPECT_MSG_SELECT, COMPUTED_STYLE_KEYS,
  validateSelectMessage, validateSelectPayload, parseSelectMessage, validateSetMessage,
} from '../../shared/src/inspect.js';

const validPayload = () => ({
  loc: 'src/App.jsx:8:10',
  tagName: 'h2',
  className: 'title',
  textContent: '登录',
  computedStyles: {
    color: 'rgb(46, 46, 44)', fontSize: '24px', fontFamily: 'sans-serif',
    backgroundColor: 'rgba(0, 0, 0, 0)', borderRadius: '0px', padding: '0px', margin: '0px',
  },
});

test('index.html 外壳包含 inspect 注入点', () => {
  assert.match(INDEX_HTML, /<script src="\/__inspect\.js"><\/script>/);
  assert.match(INDEX_HTML, /INSPECT_INJECTION_POINT/);
});

test('inspect 脚本内容完整：选择器 + hover 浮层 + postMessage 协议', () => {
  // 协议常量（与 shared/inspect.js 一致）
  assert.ok(INSPECT_SOURCE.includes(`'${INSPECT_MSG_SET}'`));
  assert.ok(INSPECT_SOURCE.includes(`'${INSPECT_MSG_SELECT}'`));
  // 关键行为：loc 读取 / hover 高亮浮层 / click 选中 / computedStyles 采集 / postMessage 回传
  assert.match(INSPECT_SOURCE, /data-source-loc/);
  assert.match(INSPECT_SOURCE, /mouseover/);
  assert.match(INSPECT_SOURCE, /getComputedStyle/);
  assert.match(INSPECT_SOURCE, /postMessage\(msg, '\*'\)/); // '*' 仅 inspect 点选时发送
  for (const k of COMPUTED_STYLE_KEYS) assert.ok(INSPECT_SOURCE.includes(k), `missing style key ${k}`);
});

test('协议 schema：合法 select 消息通过', () => {
  const msg = { type: INSPECT_MSG_SELECT, payload: validPayload() };
  assert.equal(validateSelectMessage(msg), true);
  assert.deepEqual(parseSelectMessage(msg), msg.payload);
  assert.deepEqual(validateSelectPayload(msg.payload), []);
});

test('协议 schema：非法消息被拒绝', () => {
  assert.equal(validateSelectMessage(null), false);
  assert.equal(validateSelectMessage({ type: 'other' }), false);
  assert.equal(validateSelectMessage({ type: INSPECT_MSG_SELECT, payload: null }), false);
  // 缺 computedStyles
  const p1 = validPayload(); delete p1.computedStyles;
  assert.ok(validateSelectPayload(p1).length > 0);
  // loc 形状错误
  const p2 = validPayload(); p2.loc = 'no-loc';
  assert.ok(validateSelectPayload(p2).some((e) => e.includes('loc')));
  // 多余 style key / 非字符串值
  const p3 = validPayload(); p3.computedStyles.position = 'absolute';
  assert.ok(validateSelectPayload(p3).some((e) => e.includes('position')));
  const p4 = validPayload(); p4.computedStyles.color = 1;
  assert.ok(validateSelectPayload(p4).some((e) => e.includes('color')));
  // parseSelectMessage 对非法输入返回 null（编辑器安全忽略）
  assert.equal(parseSelectMessage({ type: INSPECT_MSG_SELECT, payload: p2 }), null);
});

test('协议 schema：set 控制消息校验', () => {
  assert.equal(validateSetMessage({ type: INSPECT_MSG_SET, enabled: true }), true);
  assert.equal(validateSetMessage({ type: INSPECT_MSG_SET, enabled: 'yes' }), false);
  assert.equal(validateSetMessage({ type: INSPECT_MSG_SELECT }), false);
});

/* ---- preview-server 实际 serve ---- */
let tmp, preview, apiServer, apiBase, mgr;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-inspect-'));
  preview = createPreviewServer({ rootDir: tmp });
  await new Promise((r) => preview.listen(0, '127.0.0.1', r));
  mgr = new SandboxManager({ rootDir: path.join(tmp, 'proj') });
  apiServer = createApiServer({ sandboxManager: mgr, provider: new MockProvider() });
  await new Promise((r) => apiServer.listen(0, '127.0.0.1', r));
  apiBase = `http://127.0.0.1:${apiServer.address().port}`;
});

after(async () => {
  preview.close(); apiServer.close();
  await mgr.sandbox().stop().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true });
});

test('preview-server /__inspect.js 路由返回完整脚本', async () => {
  const port = preview.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/__inspect.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  const body = await res.text();
  assert.equal(body, INSPECT_SOURCE);
  const idx = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(idx, /__inspect\.js/);
});

test('api server 暴露 /shared/inspect.js（编辑器 import 用）', async () => {
  const res = await fetch(`${apiBase}/shared/inspect.js`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /export function validateSelectMessage/);
});
