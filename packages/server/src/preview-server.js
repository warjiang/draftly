/**
 * preview-server.js — sandbox 内置预览服务（SPEC 2.2 实现注的降级路径）。
 * Node http server + 内置 JSX 微转译 + 微型 runtime，完全离线可用。
 * 若项目内存在真实 vite（node_modules/.bin/vite），sandbox 会优先使用之（见 sandbox.js）。
 *
 * 路由：
 *   GET /                     → index.html 外壳（注入 HMR-lite + inspect 占位）
 *   GET /__runtime.js         → 微型渲染 runtime
 *   GET /__ui.css             → 内置组件样式
 *   GET /__inspect.js         → inspect 选择器脚本（hover 高亮/点选/postMessage 回传）
 *   GET /__hmr                → EventSource：文件变更 → 'reload'
 *   GET /components/ui/*.js   → registry 组件的内置实现
 *   GET /src/**.jsx|.js|.css  → 项目文件（JSX 经转译）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wrapPreviewModule, transformJsx } from './jsx.js';
import { RUNTIME_SOURCE, INDEX_HTML, INSPECT_SOURCE, UI_CSS } from './preview-runtime.js';
import { getComponentModuleSource } from './ui-components.js';

const MIME = {
  '.js': 'text/javascript', '.jsx': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.html': 'text/html',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown',
};

/**
 * @param {{ rootDir: string }} opts
 * @returns {http.Server}
 */
export function createPreviewServer({ rootDir }) {
  const hmrClients = new Set();
  let watcher = null;

  const notifyReload = debounce(() => {
    for (const res of hmrClients) {
      try { res.write('data: reload\n\n'); } catch { /* client gone */ }
    }
  }, 120);

  const startWatcher = () => {
    if (watcher) return;
    try {
      watcher = fs.watch(rootDir, { recursive: true }, (_ev, filename) => {
        if (filename && !filename.includes('node_modules')) notifyReload();
      });
    } catch { /* 某些 FS 不支持 recursive watch，静默降级为无 HMR */ }
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    const send = (code, body, type = 'text/plain') => {
      res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    };

    if (p === '/' || p === '/index.html') return send(200, INDEX_HTML, 'text/html');
    if (p === '/__runtime.js') return send(200, RUNTIME_SOURCE, 'text/javascript');
    if (p === '/__ui.css') return send(200, UI_CSS, 'text/css');
    if (p === '/__inspect.js') return send(200, INSPECT_SOURCE, 'text/javascript');

    if (p === '/__hmr') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': ok\n\n');
      hmrClients.add(res);
      req.on('close', () => hmrClients.delete(res));
      startWatcher();
      return; // 保持连接
    }

    const uiMatch = p.match(/^\/components\/ui\/([\w-]+)\.js$/);
    if (uiMatch) {
      const src = getComponentModuleSource(uiMatch[1]);
      if (!src) return send(404, `unknown component: ${uiMatch[1]}`);
      return send(200, src, 'text/javascript');
    }

    // 项目文件：防目录穿越
    const rel = p.replace(/^\/+/, '');
    const abs = path.resolve(rootDir, rel);
    if (!abs.startsWith(path.resolve(rootDir) + path.sep)) return send(403, 'forbidden');
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return send(404, `not found: ${rel}`);
    }
    const ext = path.extname(abs);
    const content = fs.readFileSync(abs, 'utf8');
    if (ext === '.jsx' || ext === '.js' || ext === '.mjs') {
      try {
        const wrapped = p.endsWith('/App.jsx')
          ? wrapPreviewModule(content, { filePath: p })
          : `import { h, Fragment } from '/__runtime.js';\n` +
            transformJsx(content.replace(/from\s+['"]@\/components\/ui\/([\w-]+)['"]/g,
              (_, n) => `from '/components/ui/${n}.js'`));
        return send(200, wrapped, 'text/javascript');
      } catch (e) {
        return send(200,
          `document.getElementById('root').innerHTML = '<pre style="color:#b4544a;padding:16px">' +
          ${JSON.stringify('Transpile error: ' + e.message).replace(/'/g, "\\'")} + '</pre>';`,
          'text/javascript');
      }
    }
    return send(200, content, MIME[ext] || 'application/octet-stream');
  });

  server.on('close', () => { if (watcher) { watcher.close(); watcher = null; } });
  return server;
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// 便于直接 `node src/preview-server.js <dir>` 手动调试
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = path.resolve(process.argv[2] || '.');
  const srv = createPreviewServer({ rootDir: dir });
  srv.listen(0, () => console.log(`preview: http://127.0.0.1:${srv.address().port}/`));
}
