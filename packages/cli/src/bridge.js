/**
 * bridge.js — 桥接代理服务（SPEC 2.4，Phase 4 / Week11）。
 *
 * startBridge({ target, port, projectDir })：
 *  - HTTP 代理转发 target（如本地 dev server）；Content-Type 含 text/html 的响应在
 *    </body> 前注入 inspect 脚本（复用 Phase 2 的 INSPECT_SOURCE，postMessage 协议与
 *    packages/shared/src/inspect.js 一致）+ HMR-lite SSE 客户端；非 HTML 原样透传。
 *  - WebSocket/HMR 升级请求降级处理：离线无 ws 库，不做 WS 帧透传。升级请求直接关闭
 *    并记日志；桥接层提供 SSE 通道 /__bridge-hmr（fs.watch projectDir → 'reload'），
 *    注入的客户端脚本收到 reload 后 location.reload() —— 即「代理模式 HMR 经桥接层
 *    SSE 重载」。dev server 自身 WS HMR 不可用时以此兜底。
 *  - /bridge/file?path=  GET 读文件 / PUT 写文件（限定 projectDir 内，防路径穿越）。
 *    PUT body: { path, content } 整写；或 { path, patch: { loc, type, value } }
 *    走 @draftly/server ast.js 的 patchElementClass/Text/Style 局部修改（保留格式）。
 *  - 编辑器 iframe 直接指向 bridge url 即可 Inspect（同源注入）。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { INSPECT_SOURCE } from '../../server/src/preview-runtime.js';
import { patchElementClass, patchElementText, patchElementStyle } from '../../server/src/ast.js';

/** 注入到 HTML 的脚本：inspect 选择器 + SSE HMR-lite 客户端 */
const HMR_CLIENT = `
(function () {
  try {
    var es = new EventSource('/__bridge-hmr');
    es.onmessage = function (ev) { if (ev.data === 'reload') location.reload(); };
  } catch (e) { /* EventSource 不可用则静默 */ }
})();
`;

const INJECTED = `<script>${INSPECT_SOURCE}</script>\n<script>${HMR_CLIENT}</script>`;

export function injectIntoHtml(html) {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${INJECTED}\n</body>`);
  return html + INJECTED;
}

/** 解析并校验 path 落在 projectDir 内；越界 → null */
function resolveInside(projectDir, rel) {
  if (typeof rel !== 'string' || !rel) return null;
  const abs = path.resolve(projectDir, rel);
  return (abs === projectDir || abs.startsWith(projectDir + path.sep)) ? abs : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/**
 * @param {{ target: string, port?: number, projectDir?: string, log?: (msg:string)=>void }} opts
 * @returns {Promise<{ url: string, server: http.Server, stop: () => Promise<void> }>}
 */
export async function startBridge({ target, port = 4600, projectDir = process.cwd(), log = console.error }) {
  if (!target) throw new Error('startBridge: target 必填');
  const targetUrl = new URL(target);
  projectDir = path.resolve(projectDir);

  const hmrClients = new Set();
  let watcher = null;
  const notifyReload = debounce(() => {
    for (const res of hmrClients) { try { res.write('data: reload\n\n'); } catch { /* gone */ } }
  }, 120);
  const startWatcher = () => {
    if (watcher) return;
    try {
      watcher = fs.watch(projectDir, { recursive: true }, (_ev, f) => {
        if (f && !f.includes('node_modules') && !f.startsWith('.git')) notifyReload();
      });
    } catch { log('[draftly bridge] fs.watch 不可用，SSE HMR 降级为不推送'); }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);

    /* ---- 桥接自身端点 ---- */
    if (p === '/__bridge-hmr') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': ok\n\n');
      hmrClients.add(res);
      req.on('close', () => hmrClients.delete(res));
      startWatcher();
      return;
    }

    if (p === '/bridge/file') {
      const abs = resolveInside(projectDir, url.searchParams.get('path'));
      if (!abs) return sendJson(res, 400, { error: 'path 缺失或越出 projectDir' });
      if (req.method === 'GET') {
        try {
          const content = fs.readFileSync(abs, 'utf8');
          return sendJson(res, 200, { path: url.searchParams.get('path'), content });
        } catch (e) {
          return sendJson(res, e.code === 'ENOENT' ? 404 : 500, { error: e.message });
        }
      }
      if (req.method === 'PUT') {
        let body;
        try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
        catch { return sendJson(res, 400, { error: 'PUT body 必须是 JSON' }); }
        try {
          if (body.patch) {
            const { loc, type, value } = body.patch;
            const code = fs.readFileSync(abs, 'utf8');
            const next = type === 'class' ? patchElementClass(code, loc, value)
              : type === 'text' ? patchElementText(code, loc, value)
              : type === 'style' ? patchElementStyle(code, loc, value)
              : (() => { throw new Error(`unknown patch type: ${type}`); })();
            fs.writeFileSync(abs, next);
            return sendJson(res, 200, { ok: true, mode: 'patch' });
          }
          if (typeof body.content !== 'string') return sendJson(res, 400, { error: 'content 必填（string），或使用 patch' });
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, body.content);
          return sendJson(res, 200, { ok: true, mode: 'write' });
        } catch (e) {
          return sendJson(res, e.code === 'ENOENT' ? 404 : 500, { error: e.message });
        }
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    /* ---- 代理转发 target ---- */
    proxy(req, res, targetUrl, log);
  });

  /* WS/HMR 升级请求降级：离线无 ws 库不透传 WS 帧，关闭并日志（HMR 走 /__bridge-hmr SSE） */
  server.on('upgrade', (req, socket) => {
    log(`[draftly bridge] WebSocket 升级请求已降级处理（无 ws 库，HMR 走 SSE /__bridge-hmr）: ${req.url}`);
    socket.write('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  const actualPort = server.address().port;
  const url = `http://localhost:${actualPort}`;
  return {
    url,
    server,
    stop: () => new Promise((resolve) => {
      for (const res of hmrClients) { try { res.end(); } catch { /* gone */ } }
      if (watcher) watcher.close();
      server.close(() => resolve());
    }),
  };
}

/** 转发请求到 target；text/html 注入脚本，其余透传 */
function proxy(req, res, targetUrl, log) {
  const headers = { ...req.headers, host: targetUrl.host, 'accept-encoding': 'identity' };
  const upstream = http.request({
    hostname: targetUrl.hostname,
    port: targetUrl.port || 80,
    path: req.url,
    method: req.method,
    headers,
  }, (upRes) => {
    const type = String(upRes.headers['content-type'] || '');
    const chunks = [];
    upRes.on('data', (c) => chunks.push(c));
    upRes.on('end', () => {
      const body = Buffer.concat(chunks);
      const outHeaders = { ...upRes.headers };
      delete outHeaders['content-length'];
      delete outHeaders['content-encoding'];
      if (upRes.statusCode === 200 && /text\/html/i.test(type)) {
        outHeaders['content-type'] = type;
        res.writeHead(upRes.statusCode, outHeaders);
        res.end(injectIntoHtml(body.toString('utf8')));
      } else {
        res.writeHead(upRes.statusCode, outHeaders);
        res.end(body);
      }
    });
  });
  upstream.on('error', (e) => {
    log(`[draftly bridge] target 不可达: ${e.message}`);
    if (!res.headersSent) sendJson(res, 502, { error: `target unreachable: ${e.message}` });
    else res.end();
  });
  req.pipe(upstream);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
