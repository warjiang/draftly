import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startBridge, injectIntoHtml } from '../src/bridge.js';

/** 起一个模拟 target dev server */
function startTarget() {
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>t</title></head><body><h1>hello</h1></body></html>');
    } else if (req.url === '/no-body-tag') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><h1>frag</h1></html>');
    } else if (req.url === '/style.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end('body { color: red; }');
    } else if (req.url === '/data.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"a":1}');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('nope');
    }
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function get(url, opts) {
  const res = await fetch(url, opts);
  return { status: res.status, headers: res.headers, text: await res.text() };
}

test('bridge: HTML 注入 inspect 脚本，CSS/JSON 透传', async () => {
  const target = await startTarget();
  const tPort = target.address().port;
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-bridge-'));
  const bridge = await startBridge({ target: `http://localhost:${tPort}`, port: 0, projectDir, log: () => {} });
  try {
    const html = await get(`${bridge.url}/`);
    assert.equal(html.status, 200);
    assert.match(html.text, /draftly:inspect:select/); // inspect 协议
    assert.match(html.text, /__DRAFTLY_INSPECT__/);
    assert.match(html.text, /<h1>hello<\/h1>/); // 原内容保留
    assert.match(html.text, /__bridge-hmr/); // SSE HMR 客户端
    assert.ok(html.text.indexOf('__DRAFTLY_INSPECT__') < html.text.indexOf('</body>'), '注入在 </body> 前');

    const frag = await get(`${bridge.url}/no-body-tag`);
    assert.match(frag.text, /__DRAFTLY_INSPECT__/); // 无 </body> 时追加到尾部

    const css = await get(`${bridge.url}/style.css`);
    assert.equal(css.text, 'body { color: red; }');
    assert.match(css.headers.get('content-type'), /text\/css/);

    const json = await get(`${bridge.url}/data.json`);
    assert.equal(json.text, '{"a":1}');

    const nf = await get(`${bridge.url}/missing`);
    assert.equal(nf.status, 404);
  } finally {
    await bridge.stop();
    target.close();
  }
});

test('bridge: /bridge/file GET/PUT 读写 + ast patch + 路径穿越防护', async () => {
  const target = await startTarget();
  const tPort = target.address().port;
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-bridge-'));
  fs.mkdirSync(path.join(projectDir, 'src'));
  fs.writeFileSync(path.join(projectDir, 'src', 'App.jsx'),
    'export function App() {\n  return <div className="old">Hi</div>;\n}\n');
  const bridge = await startBridge({ target: `http://localhost:${tPort}`, port: 0, projectDir, log: () => {} });
  try {
    // GET
    const r1 = await get(`${bridge.url}/bridge/file?path=${encodeURIComponent('src/App.jsx')}`);
    assert.equal(r1.status, 200);
    assert.match(JSON.parse(r1.text).content, /className="old"/);

    // GET 404
    const r2 = await get(`${bridge.url}/bridge/file?path=nope.js`);
    assert.equal(r2.status, 404);

    // 路径穿越
    const r3 = await get(`${bridge.url}/bridge/file?path=${encodeURIComponent('../../etc/passwd')}`);
    assert.equal(r3.status, 400);

    // PUT 整写
    const r4 = await get(`${bridge.url}/bridge/file?path=src/New.jsx`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'export const New = () => <span data-source-loc="src/New.jsx:1:22">n</span>;\n' }),
    });
    assert.equal(r4.status, 200);
    assert.match(fs.readFileSync(path.join(projectDir, 'src', 'New.jsx'), 'utf8'), /New/);

    // PUT ast patch（class）
    const r5 = await get(`${bridge.url}/bridge/file?path=${encodeURIComponent('src/App.jsx')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { loc: 'src/App.jsx:2:11', type: 'class', value: 'new-class' } }),
    });
    assert.equal(r5.status, 200);
    const patched = fs.readFileSync(path.join(projectDir, 'src', 'App.jsx'), 'utf8');
    assert.match(patched, /className="new-class"/);
    assert.match(patched, />Hi</); // 其余内容不动
  } finally {
    await bridge.stop();
    target.close();
  }
});

test('bridge: WS upgrade 降级（501 + socket 关闭），SSE 通道可连接', async () => {
  const target = await startTarget();
  const tPort = target.address().port;
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-bridge-'));
  let logged = '';
  const bridge = await startBridge({ target: `http://localhost:${tPort}`, port: 0, projectDir, log: (m) => { logged += m + '\n'; } });
  try {
    // WS 升级请求 → 501
    const resp = await new Promise((resolve, reject) => {
      const req = http.request({ host: 'localhost', port: bridge.server.address().port, path: '/ws', headers: { Connection: 'Upgrade', Upgrade: 'websocket' } });
      req.on('response', resolve);
      req.on('error', reject);
      req.end();
    });
    assert.equal(resp.statusCode, 501);
    assert.match(logged, /降级/);

    // SSE 连接 → 首包 ': ok'
    const sse = await fetch(`${bridge.url}/__bridge-hmr`);
    assert.equal(sse.status, 200);
    assert.match(sse.headers.get('content-type'), /text\/event-stream/);
    const reader = sse.body.getReader();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /: ok/);
    await reader.cancel();
  } finally {
    await bridge.stop();
    target.close();
  }
});

test('injectIntoHtml: 幂等注入点行为', () => {
  const out = injectIntoHtml('<html><body>x</body></html>');
  assert.match(out, /__DRAFTLY_INSPECT__/);
  assert.match(out, /<\/body><\/html>$/);
  const out2 = injectIntoHtml('plain');
  assert.match(out2, /^plain<script>/);
});
