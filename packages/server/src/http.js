/**
 * http.js - REST API 层（HTML 草稿模式 M1-M4）
 * createApiServer({ provider, editorDir, drafts }) -> http.Server
 *
 * 端点：
 *   POST /api/draft/generate {prompt, variants?, style?}
 *   GET  /api/drafts
 *   GET  /api/draft/:id?v=N
 *   GET  /api/draft/:id/export
 *   POST /api/draft/:id/iterate {instruction}
 *   POST /api/draft/:id/edit-element {did, instruction}
 *   POST /api/draft/:id/rollback {v}
 *   GET  /api/templates           GET /api/templates/:id
 *   POST /api/extract {html, css} | {url}   （M5 反向提取预留）
 * 静态：
 *   GET /  -> packages/editor/public/drafts.html
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDesign, fetchSiteAssets } from './extract.js';
import { loadTemplates, templateSummary, getTemplate } from './templates.js';
import { generateDrafts, iterateDraft, editDraftElement, editDraftByImage } from './draft-generate.js';

const EDITOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../editor/public');

/**
 * @param {{ provider: object, editorDir?: string, drafts: object }} opts
 * drafts 为 DraftStore 实例，必传
 */
export function createApiServer({ provider, editorDir = EDITOR_DIR, drafts } = {}) {
  if (!drafts) throw new Error('createApiServer: drafts store required');
  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, { provider, editorDir, drafts });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  });
  return server;
}

async function route(req, res, ctx) {
  const { provider, editorDir, drafts } = ctx;
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  /* ---------- 静态编辑器 ---------- */
  if (!p.startsWith('/api/')) {
    return serveStatic(res, editorDir, p === '/' ? '/drafts.html' : p);
  }

  /* ---------- API ---------- */
  const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : null;
  const json = body ? safeJson(body) : null;

  /* ---------- HTML 草稿（M1-M4） ---------- */
  if (p === '/api/draft/generate' && req.method === 'POST') {
    if (!json?.prompt) return sendJson(res, 400, { error: 'prompt required' });
    // 风格预设（M4）：指定 style 时用模板库的 designMd 作为设计契约；否则不注入
    let designMd = null;
    if (json.style) {
      const t = await getTemplate(String(json.style));
      if (!t) return sendJson(res, 400, { error: `unknown style: ${json.style}` });
      designMd = t.designMd;
    }
    try {
      const result = await generateDrafts({
        drafts, provider,
        prompt: json.prompt, variants: json.variants, designMd,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }

  if (p === '/api/drafts' && req.method === 'GET') {
    return sendJson(res, 200, { drafts: await drafts.list() });
  }

  const draftGet = /^\/api\/draft\/([^/]+)$/.exec(p);
  if (draftGet && req.method === 'GET') {
    const v = url.searchParams.get('v');
    try {
      const { meta, html, version } = await drafts.readHtml(
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
      const { meta, html, version } = await drafts.readHtml(decodeURIComponent(draftExport[1]));
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
      const result = await iterateDraft({ drafts, provider, id, instruction: json.instruction });
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
      const result = await editDraftElement({ drafts, provider, id, did, instruction });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, e.status || 502, { error: e.message });
    }
  }

  const draftEditByImage = /^\/api\/draft\/([^/]+)\/edit-by-image$/.exec(p);
  if (draftEditByImage && req.method === 'POST') {
    // 截图修改（M5）：截图 base64(data URL) + 指令 -> 修改后整页 HTML
    const { image, instruction } = json || {};
    if (!image) return sendJson(res, 400, { error: 'image required' });
    if (!instruction) return sendJson(res, 400, { error: 'instruction required' });
    const id = decodeURIComponent(draftEditByImage[1]);
    try {
      const result = await editDraftByImage({ drafts, provider, id, image, instruction });
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
      const { meta, version } = await drafts.rollbackVersion(id, v);
      return sendJson(res, 200, { id: meta.id, title: meta.title, version });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }

  /* ---------- 模板库（M4 风格预设） ---------- */
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

  /* ---------- 设计提取（M5 预留：DESIGN.md 反向提取） ---------- */
  if (p === '/api/extract' && req.method === 'POST') {
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

  sendJson(res, 404, { error: `unknown endpoint: ${req.method} ${p}` });
}

/* ---------- 工具 ---------- */

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e7) reject(new Error('body too large')); });
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
