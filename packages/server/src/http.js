/**
 * http.js — REST API 层（SPEC 2.2）
 * createApiServer({ sandboxManager, provider }) → http.Server
 *
 * 端点（SPEC）：
 *   GET  /api/files                GET/PUT /api/file?path=
 *   POST /api/generate {prompt}    POST /api/patch {loc, type, value}
 *   POST /api/sandbox/start|stop   GET /api/sandbox/status
 *   GET/PUT /api/design-md
 *   GET  /api/templates            POST /api/templates/apply {id}   （Phase 3 填充，现为空/501）
 * 扩展：
 *   POST /api/history/undo|redo    GET /api/history                 （SPEC 2.3 Undo/Redo）
 *   GET  /api/registry             POST /api/insert {name}          （编辑器组件面板/拖拽落地）
 * 静态：
 *   GET /            → packages/editor/public（无构建 SPA）
 *   GET /preview/*   → 同源代理到 sandbox preview-server（iframe 用；同源使 Phase 1
 *                      可在编辑器侧直接读 iframe DOM 的 data-source-loc，inspect 注入脚本
 *                      在 Phase 2 才用于跨域场景）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDesignMd } from '../../shared/src/design-md.js';
import { loadBuiltinRegistry } from '../../shared/src/registry.js';
import { generatePage } from './generate.js';
import { patchElementClass, patchElementText, patchElementStyle } from './ast.js';
import { editElement } from './nl-edit.js';
import { extractDesign, fetchSiteAssets } from './extract.js';
import { loadTemplates, templateSummary, getTemplate, applyTemplate } from './templates.js';
import { DraftStore } from './drafts.js';
import { generateDrafts, iterateDraft, editDraftElement } from './draft-generate.js';

const EDITOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../editor/public');
const APP_FILE = 'src/App.jsx';

/**
 * @param {{ sandboxManager: object, provider: object, editorDir?: string, drafts?: object }} opts
 * sandboxManager 需具备：sandbox(), ensureStarted(), history()
 * drafts 缺省时惰性创建在 <sandbox 根目录>/../drafts
 */
export function createApiServer({ sandboxManager, provider, editorDir = EDITOR_DIR, drafts = null } = {}) {
  let draftsStore = drafts;
  const getDrafts = () => {
    if (!draftsStore) {
      draftsStore = new DraftStore({
        rootDir: path.resolve(sandboxManager.sandbox().rootDir, '..', 'drafts'),
      });
    }
    return draftsStore;
  };
  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, { sandboxManager, provider, editorDir, getDrafts });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  });
  return server;
}

async function route(req, res, ctx) {
  const { sandboxManager, provider, editorDir, getDrafts } = ctx;
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  /* ---------- preview 同源代理 ---------- */
  if (p === '/preview' || p.startsWith('/preview/')) {
    const { port } = await sandboxManager.ensureStarted();
    const target = p.replace(/^\/preview\/?/, '/');
    return proxy(req, res, port, target + (url.search || ''));
  }

  /* ---------- 静态编辑器 ---------- */
  if (!p.startsWith('/api/')) {
    // /shared/* → @draftly/shared 源码（编辑器与 server 共用协议/常量，无构建直引 ESM）
    if (p.startsWith('/shared/')) {
      const sharedDir = path.resolve(editorDir, '../../shared/src');
      return serveStatic(res, sharedDir, p.slice('/shared'.length));
    }
    return serveStatic(res, editorDir, p === '/' ? '/index.html' : p);
  }

  /* ---------- API ---------- */
  const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : null;
  const json = body ? safeJson(body) : null;

  /* ---------- HTML 草稿（M1）：不依赖 sandbox，直接落盘 .draftly/drafts ---------- */
  if (p === '/api/draft/generate' && req.method === 'POST') {
    if (!json?.prompt) return sendJson(res, 400, { error: 'prompt required' });
    // 风格预设（M4）：指定 style 时用模板库的 designMd 作为设计契约；
    // 否则 DESIGN.md 存在则注入；不存在/读取失败则按默认风格生成
    let designMd = null;
    if (json.style) {
      const t = await getTemplate(String(json.style));
      if (!t) return sendJson(res, 400, { error: `unknown style: ${json.style}` });
      designMd = t.designMd;
    } else {
      try {
        await sandboxManager.ensureCreated();
        designMd = await sandboxManager.sandbox().readFile('DESIGN.md');
      } catch { /* 无设计契约 */ }
    }
    try {
      const result = await generateDrafts({
        drafts: getDrafts(), provider,
        prompt: json.prompt, variants: json.variants, designMd,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }

  if (p === '/api/drafts' && req.method === 'GET') {
    return sendJson(res, 200, { drafts: await getDrafts().list() });
  }

  const draftGet = /^\/api\/draft\/([^/]+)$/.exec(p);
  if (draftGet && req.method === 'GET') {
    const v = url.searchParams.get('v');
    try {
      const { meta, html, version } = await getDrafts().readHtml(
        decodeURIComponent(draftGet[1]), v ? Number(v) : null);
      return sendJson(res, 200, { meta, html, version });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }

  const draftExport = /^\/api\/draft\/([^/]+)\/export$/.exec(p);
  if (draftExport && req.method === 'GET') {
    // 导出 HTML（M4）：最新版本整页下载
    try {
      const { meta, html, version } = await getDrafts().readHtml(decodeURIComponent(draftExport[1]));
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="draftly-${meta.id}-v${version}.html"`,
        'Cache-Control': 'no-store',
      });
      return res.end(html);
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }

  const draftIterate = /^\/api\/draft\/([^/]+)\/iterate$/.exec(p);
  if (draftIterate && req.method === 'POST') {
    if (!json?.instruction) return sendJson(res, 400, { error: 'instruction required' });
    const id = decodeURIComponent(draftIterate[1]);
    try {
      const result = await iterateDraft({
        drafts: getDrafts(), provider, id, instruction: json.instruction,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, e.status || 502, { error: e.message });
    }
  }

  const draftEditElement = /^\/api\/draft\/([^/]+)\/edit-element$/.exec(p);
  if (draftEditElement && req.method === 'POST') {
    const { did, instruction } = json || {};
    if (did === undefined || did === null || did === '') return sendJson(res, 400, { error: 'did required' });
    if (!instruction) return sendJson(res, 400, { error: 'instruction required' });
    const id = decodeURIComponent(draftEditElement[1]);
    try {
      const result = await editDraftElement({
        drafts: getDrafts(), provider, id, did, instruction,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, e.status || 502, { error: e.message });
    }
  }

  const draftRollback = /^\/api\/draft\/([^/]+)\/rollback$/.exec(p);
  if (draftRollback && req.method === 'POST') {
    const v = json?.v ?? url.searchParams.get('v');
    if (v === null || v === undefined || v === '') return sendJson(res, 400, { error: 'v required' });
    const id = decodeURIComponent(draftRollback[1]);
    try {
      const { meta, version } = await getDrafts().rollbackVersion(id, v);
      return sendJson(res, 200, { id: meta.id, title: meta.title, version });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }

  await sandboxManager.ensureCreated();

  if (p === '/api/files' && req.method === 'GET') {
    return sendJson(res, 200, { files: await sandboxManager.sandbox().listFiles() });
  }

  if (p === '/api/file') {
    const rel = url.searchParams.get('path');
    if (!rel) return sendJson(res, 400, { error: 'path required' });
    if (req.method === 'GET') {
      try {
        return sendJson(res, 200, { path: rel, content: await sandboxManager.sandbox().readFile(rel) });
      } catch { return sendJson(res, 404, { error: `not found: ${rel}` }); }
    }
    if (req.method === 'PUT') {
      const content = json?.content ?? body;
      await sandboxManager.history().write(rel, content);
      return sendJson(res, 200, { ok: true, path: rel });
    }
  }

  if (p === '/api/generate' && req.method === 'POST') {
    if (!json?.prompt) return sendJson(res, 400, { error: 'prompt required' });
    // 生成前快照，生成后补记历史
    const before = await sandboxManager.history().current(APP_FILE);
    const result = await generatePage({ sandbox: sandboxManager.sandbox(), provider, userPrompt: json.prompt });
    sandboxManager.history().pushEntry(result.file, before, result.code);
    return sendJson(res, 200, result);
  }

  if (p === '/api/patch' && req.method === 'POST') {
    const { loc, type, value } = json || {};
    if (!loc || !type) return sendJson(res, 400, { error: 'loc and type required' });
    const file = loc.split(':').slice(0, -2).join(':') || APP_FILE;
    const patchFn = { class: patchElementClass, text: patchElementText, style: patchElementStyle }[type];
    if (!patchFn) return sendJson(res, 400, { error: `unknown patch type: ${type}` });
    const after = await sandboxManager.history().mutate(file, (code) => patchFn(code, loc, value));
    return sendJson(res, 200, { ok: true, file, content: after });
  }

  if (p === '/api/nl-edit' && req.method === 'POST') {
    // 自然语言改元素（Phase 2 Task 2.3）：LLM/Mock → ast patch → 写文件 → history 快照
    const { loc, instruction } = json || {};
    if (!loc || !instruction) return sendJson(res, 400, { error: 'loc and instruction required' });
    try {
      const result = await editElement({
        sandbox: sandboxManager.sandbox(), provider, loc, instruction,
        history: sandboxManager.history(),
      });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      return sendJson(res, 422, { error: e.message });
    }
  }

  if (p === '/api/insert' && req.method === 'POST') {
    // 编辑器拖拽落地（Phase 1 简化）：把组件片段插入根节点末尾
    const name = json?.name;
    const reg = loadBuiltinRegistry();
    const comp = reg.components.find((c) => c.name === name);
    if (!comp) return sendJson(res, 400, { error: `unknown component: ${name}` });
    const snippetMap = {
      Button: `<Button variant="default">新按钮</Button>`,
      Input: `<Input type="text" placeholder="请输入" />`,
      Card: `<Card><p>新卡片</p></Card>`,
      Badge: `<Badge>标签</Badge>`,
      Alert: `<Alert>提示信息</Alert>`,
      Separator: `<Separator />`,
      Progress: `<Progress value={50} />`,
      Switch: `<Switch />`,
      Textarea: `<Textarea placeholder="多行输入" />`,
      Select: `<Select options={['选项一', '选项二']} />`,
    };
    const snippet = snippetMap[name] || `<${name} />`;
    const after = await sandboxManager.history().mutate(APP_FILE, (code) =>
      insertSnippet(code, snippet, comp));
    return sendJson(res, 200, { ok: true, file: APP_FILE, content: after });
  }

  if (p === '/api/sandbox/start' && req.method === 'POST') {
    return sendJson(res, 200, await sandboxManager.ensureStarted());
  }
  if (p === '/api/sandbox/stop' && req.method === 'POST') {
    await sandboxManager.sandbox().stop();
    return sendJson(res, 200, { ok: true, running: false });
  }
  if (p === '/api/sandbox/status' && req.method === 'GET') {
    const sbx = sandboxManager.sandbox();
    return sendJson(res, 200, { running: sbx.isRunning(), port: sbx.port, url: sbx.url });
  }

  if (p === '/api/design-md') {
    if (req.method === 'GET') {
      let content;
      try { content = await sandboxManager.sandbox().readFile('DESIGN.md'); }
      catch { content = defaultDesignMd(); await sandboxManager.history().write('DESIGN.md', content); }
      return sendJson(res, 200, { content });
    }
    if (req.method === 'PUT') {
      await sandboxManager.history().write('DESIGN.md', json?.content ?? body);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (p === '/api/registry' && req.method === 'GET') {
    return sendJson(res, 200, loadBuiltinRegistry());
  }

  if (p === '/api/history' && req.method === 'GET') {
    return sendJson(res, 200, sandboxManager.history().status());
  }
  if (p === '/api/history/undo' && req.method === 'POST') {
    const r = await sandboxManager.history().undo();
    return sendJson(res, r ? 200 : 409, r ? { ok: true, ...r } : { error: 'nothing to undo' });
  }
  if (p === '/api/history/redo' && req.method === 'POST') {
    const r = await sandboxManager.history().redo();
    return sendJson(res, r ? 200 : 409, r ? { ok: true, ...r } : { error: 'nothing to redo' });
  }

  if (p === '/api/extract' && req.method === 'POST') {
    // Phase 3 Task 3.2：设计系统提取。两条路径：
    //  { html, css }  —— 核心路径（离线可用）：html 字符串 + css 文本（字符串或数组）
    //  { url }        —— 可选增强：有网络时 fetch 真实网页；失败返回 501 + 引导粘贴 HTML
    try {
      if (json?.url) {
        const assets = await fetchSiteAssets(json.url);
        return sendJson(res, 200, extractDesign(assets));
      }
      const cssTexts = Array.isArray(json?.css) ? json.css : (json?.css ? [json.css] : []);
      if (!json?.html && !cssTexts.length) {
        return sendJson(res, 400, { error: 'required: { html, css } 或 { url }' });
      }
      return sendJson(res, 200, extractDesign({ html: json.html || '', cssTexts }));
    } catch (e) {
      const status = e.code === 'EXTRACT_OFFLINE' ? 501 : 500;
      return sendJson(res, status, { error: e.message, hint: 'POST /api/extract { html, css } 可直接粘贴页面源码（离线可用）' });
    }
  }

  /* Phase 3 Task 3.3：模板库 */
  if (p === '/api/templates' && req.method === 'GET') {
    const all = await loadTemplates();
    return sendJson(res, 200, { templates: all.map(templateSummary) });
  }
  if (p.startsWith('/api/templates/') && req.method === 'GET') {
    const id = p.slice('/api/templates/'.length);
    const t = await getTemplate(decodeURIComponent(id));
    if (!t) return sendJson(res, 404, { error: `unknown template: ${id}` });
    return sendJson(res, 200, t);
  }
  if (p === '/api/templates/apply' && req.method === 'POST') {
    if (!json?.id) return sendJson(res, 400, { error: 'id required' });
    try {
      const result = await applyTemplate({
        history: sandboxManager.history(), sandbox: sandboxManager.sandbox(), provider,
        id: json.id, regenerate: !!json.regenerate, prompt: json.prompt,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }

  sendJson(res, 404, { error: `unknown endpoint: ${req.method} ${p}` });
}

/** 拖拽落地片段插入：优先插入根容器闭合标签之前；并补齐 import */
export function insertSnippet(code, snippet, comp) {
  let out = code;
  // 补 import（幂等）
  const mod = comp.import.replace('@/components/ui/', '');
  const importLine = `import { ${comp.name} } from '@/components/ui/${mod}';`;
  if (!new RegExp(`import\\s*\\{[^}]*\\b${comp.name}\\b[^}]*\\}\\s*from`).test(out)) {
    out = importLine + '\n' + out;
  }
  // 插到最后一个 `    </div>\n  );`（根容器收尾）之前；找不到则报错
  const marker = /\n(\s*)<\/div>\n\s*\);\s*\n?\}?\s*$/;
  const m = marker.exec(out);
  if (!m) throw new Error('insert: cannot locate root container closing tag');
  const indent = m[1] + '  ';
  return out.slice(0, m.index) + `\n${indent}${snippet}` + out.slice(m.index);
}

/* ---------- 工具 ---------- */

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) reject(new Error('body too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

const STATIC_MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function serveStatic(res, dir, p) {
  const abs = path.resolve(dir, p.replace(/^\/+/, ''));
  if (!abs.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': (STATIC_MIME[path.extname(abs)] || 'application/octet-stream') + '; charset=utf-8' });
  fs.createReadStream(abs).pipe(res);
}

/** 反代到 preview-server（含 SSE 透传：/preview/__hmr） */
function proxy(req, res, port, target) {
  const preq = http.request({ host: '127.0.0.1', port, path: target, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (pres) => {
    res.writeHead(pres.statusCode, pres.headers);
    pres.pipe(res);
  });
  preq.on('error', (e) => sendJson(res, 502, { error: `preview proxy: ${e.message}` }));
  req.pipe(preq);
}
