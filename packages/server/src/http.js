import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import {
  editDraftByImage,
  editDraftSource,
  generateDrafts,
  iterateDraft,
} from './draft-generate.js';
import { extractDesign, fetchSiteAssets } from './extract.js';
import { PreviewManager } from './preview-manager.js';
import { assertNoEscapingSymlinks } from './source-locator.js';
import { getTemplate, loadTemplates, templateSummary } from './templates.js';

const EDITOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../editor/dist');

export function createApiServer({
  provider,
  editorDir = EDITOR_DIR,
  drafts,
  previewManager = null,
} = {}) {
  if (!drafts) throw new Error('createApiServer: drafts store required');
  const previews = previewManager || new PreviewManager({ drafts });
  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, { provider, editorDir, drafts, previews });
    } catch (error) {
      if (!res.headersSent) sendJson(res, error.status || 500, { error: error.message });
      else res.destroy(error);
    }
  });
  server.previewManager = previews;
  server.on('close', () => {
    previews.shutdown?.().catch(() => {});
  });
  return server;
}

async function route(req, res, context) {
  const { provider, editorDir, drafts, previews } = context;
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const stream = url.searchParams.get('stream') === '1';

  if (!pathname.startsWith('/api/')) {
    return serveStatic(res, editorDir, pathname === '/' ? '/index.html' : pathname);
  }

  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : null;
  const json = body ? safeJson(body) : null;
  if (body && json === null) return sendJson(res, 400, { error: 'invalid JSON body' });

  if (pathname === '/api/drafts/generate' && req.method === 'POST') {
    if (!json?.prompt?.trim()) return sendJson(res, 400, { error: 'prompt required' });
    let designMd = null;
    if (json.style) {
      const template = await getTemplate(String(json.style));
      if (!template) return sendJson(res, 400, { error: `unknown style: ${json.style}` });
      designMd = template.designMd;
    }
    const execute = (onProgress) => generateDrafts({
      drafts,
      provider,
      prompt: json.prompt,
      variants: json.variants,
      designMd,
      onProgress,
    });
    return stream ? streamResult(res, execute) : sendOperation(res, execute, 502);
  }

  if (pathname === '/api/drafts' && req.method === 'GET') {
    return sendJson(res, 200, { drafts: await drafts.list() });
  }

  const detail = /^\/api\/drafts\/([^/]+)$/.exec(pathname);
  if (detail && req.method === 'GET') {
    const id = decodeURIComponent(detail[1]);
    const meta = await drafts.meta(id);
    let source = null;
    try {
      source = await drafts.readSource(id, url.searchParams.get('file') || 'src/App.tsx');
    } catch (error) {
      if (url.searchParams.has('file')) throw error;
    }
    return sendJson(res, 200, {
      meta,
      version: meta.versions.length,
      source: source ? { file: source.file, content: source.source } : null,
    });
  }

  const sourceRoute = /^\/api\/drafts\/([^/]+)\/source$/.exec(pathname);
  if (sourceRoute && req.method === 'GET') {
    const file = url.searchParams.get('file') || 'src/App.tsx';
    const version = url.searchParams.get('v');
    const result = await drafts.readSource(
      decodeURIComponent(sourceRoute[1]),
      file,
      version ? Number(version) : null,
    );
    return sendJson(res, 200, result);
  }

  const previewRoute = /^\/api\/drafts\/([^/]+)\/preview$/.exec(pathname);
  if (previewRoute && req.method === 'POST') {
    const preview = await previews.ensure(decodeURIComponent(previewRoute[1]));
    return sendJson(res, 200, preview);
  }

  const iterateRoute = /^\/api\/drafts\/([^/]+)\/iterate$/.exec(pathname);
  if (iterateRoute && req.method === 'POST') {
    if (!json?.instruction?.trim()) return sendJson(res, 400, { error: 'instruction required' });
    const execute = (onProgress) => iterateDraft({
      drafts,
      provider,
      id: decodeURIComponent(iterateRoute[1]),
      instruction: json.instruction,
      onProgress,
    });
    return stream ? streamResult(res, execute) : sendOperation(res, execute, 502);
  }

  const editSourceRoute = /^\/api\/drafts\/([^/]+)\/edit-source$/.exec(pathname);
  if (editSourceRoute && req.method === 'POST') {
    if (!json?.instruction?.trim()) return sendJson(res, 400, { error: 'instruction required' });
    if (!json?.locator) return sendJson(res, 400, { error: 'locator required' });
    const execute = (onProgress) => editDraftSource({
      drafts,
      provider,
      id: decodeURIComponent(editSourceRoute[1]),
      locator: json.locator,
      instruction: json.instruction,
      onProgress,
    });
    return stream ? streamResult(res, execute) : sendOperation(res, execute, 502);
  }

  const editImageRoute = /^\/api\/drafts\/([^/]+)\/edit-by-image$/.exec(pathname);
  if (editImageRoute && req.method === 'POST') {
    if (!json?.image) return sendJson(res, 400, { error: 'image required' });
    if (!json?.instruction?.trim()) return sendJson(res, 400, { error: 'instruction required' });
    const execute = (onProgress) => editDraftByImage({
      drafts,
      provider,
      id: decodeURIComponent(editImageRoute[1]),
      image: json.image,
      instruction: json.instruction,
      onProgress,
    });
    return stream ? streamResult(res, execute) : sendOperation(res, execute, 502);
  }

  const rollbackRoute = /^\/api\/drafts\/([^/]+)\/rollback$/.exec(pathname);
  if (rollbackRoute && req.method === 'POST') {
    if (json?.v === undefined || json.v === null) {
      return sendJson(res, 400, { error: 'v required' });
    }
    const execute = async (onProgress) => {
      onProgress?.({ type: 'pipeline', stage: 'rollback_started', target: Number(json.v) });
      const result = await drafts.rollbackVersion(decodeURIComponent(rollbackRoute[1]), json.v);
      onProgress?.({ type: 'pipeline', stage: 'version_saved', version: result.version });
      return {
        id: result.meta.id,
        title: result.meta.title,
        version: result.version,
      };
    };
    return stream ? streamResult(res, execute) : sendOperation(res, execute);
  }

  const diffRoute = /^\/api\/drafts\/([^/]+)\/versions\/(\d+)\/diff$/.exec(pathname);
  if (diffRoute && req.method === 'GET') {
    return sendJson(
      res,
      200,
      await drafts.versionDiff(decodeURIComponent(diffRoute[1]), Number(diffRoute[2])),
    );
  }

  const exportRoute = /^\/api\/drafts\/([^/]+)\/export$/.exec(pathname);
  if (exportRoute && req.method === 'GET') {
    return exportSource(res, drafts, decodeURIComponent(exportRoute[1]));
  }

  if (pathname === '/api/templates' && req.method === 'GET') {
    const templates = await loadTemplates();
    return sendJson(res, 200, { templates: templates.map(templateSummary) });
  }

  if (pathname.startsWith('/api/templates/') && req.method === 'GET') {
    const id = decodeURIComponent(pathname.slice('/api/templates/'.length));
    const template = await getTemplate(id);
    if (!template) return sendJson(res, 404, { error: `unknown template: ${id}` });
    return sendJson(res, 200, template);
  }

  if (pathname === '/api/extract' && req.method === 'POST') {
    if (json?.url) return sendJson(res, 200, extractDesign(await fetchSiteAssets(json.url)));
    const cssTexts = Array.isArray(json?.css) ? json.css : (json?.css ? [json.css] : []);
    if (!json?.html && !cssTexts.length) {
      return sendJson(res, 400, { error: 'required: { html, css } or { url }' });
    }
    return sendJson(res, 200, extractDesign({ html: json.html || '', cssTexts }));
  }

  return sendJson(res, 404, { error: `unknown endpoint: ${req.method} ${pathname}` });
}

async function sendOperation(res, execute, errorStatus = 500) {
  try {
    return sendJson(res, 200, await execute());
  } catch (error) {
    return sendJson(res, error.status || errorStatus, { error: error.message });
  }
}

async function streamResult(res, execute) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const send = (payload) => res.write(`${JSON.stringify(payload)}\n`);
  try {
    const result = await execute((event) => send({ type: 'progress', event }));
    send({ type: 'result', data: result });
  } catch (error) {
    send({ type: 'error', error: error.message, status: error.status || 500 });
  } finally {
    res.end();
  }
}

async function exportSource(res, drafts, id) {
  const meta = await drafts.meta(id);
  const version = meta.versions.length;
  const projectDir = drafts.projectDir(id);
  await assertNoEscapingSymlinks(projectDir);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="draftly-${meta.id}-v${version}.zip"`,
    'Cache-Control': 'no-store',
  });
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error) => res.destroy(error));
  archive.pipe(res);
  archive.glob('**/*', {
    cwd: projectDir,
    dot: true,
    ignore: [
      '.git',
      '.git/**',
      'node_modules',
      'node_modules/**',
      'dist',
      'dist/**',
      '.draftly-input',
      '.draftly-input/**',
      '**/*.tsbuildinfo',
    ],
  });
  await archive.finalize();
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000_000) {
        const error = new Error('body too large');
        error.status = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const STATIC_MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function serveStatic(res, directory, requestPath) {
  const root = path.resolve(directory);
  const absolute = path.resolve(root, requestPath.replace(/^\/+/, ''));
  if (
    !absolute.startsWith(`${root}${path.sep}`)
    || !fs.existsSync(absolute)
    || !fs.statSync(absolute).isFile()
  ) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, {
    'Content-Type': `${STATIC_MIME[path.extname(absolute)] || 'application/octet-stream'}; charset=utf-8`,
  });
  return fs.createReadStream(absolute).pipe(res);
}
