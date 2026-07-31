#!/usr/bin/env node
/**
 * smoke-draft.mjs - HTML 草稿模式端到端冒烟（M1-M5）
 * 启动真实 dev server（Mock Provider），走一遍：
 *   模板列表 -> 生成(多变体+风格预设) -> 列表 -> 详情 -> 迭代 -> 点选修改 -> 截图修改 -> 回退 -> 导出 -> 静态根
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const draftsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-smoke-'));

// PORT=0 让 OS 分配随机端口，从 stdout 解析实际端口
const server = spawn(process.execPath, ['packages/server/src/dev.js'], {
  env: {
    ...process.env,
    PORT: '0',
    DRAFTLY_DRAFTS_DIR: draftsDir,
    DRAFTLY_LLM_API_KEY: '',
    DRAFTLY_LLM_BASE_URL: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let buf = '';
let port = null;
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`server start timeout\n${buf}`)), 10_000);
  server.stdout.on('data', (c) => {
    buf += c.toString();
    if (!port) {
      const m = buf.match(/running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { port = m[1]; clearTimeout(timer); resolve(); }
    }
  });
  server.stderr.on('data', (c) => { buf += c.toString(); });
  server.on('exit', (code) => {
    if (!port) reject(new Error(`server exited early code=${code}\n${buf}`));
  });
});

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
};

const fetchJson = async (p, opts = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, opts.method ? {
    method: opts.method,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  } : undefined);
  return { status: res.status, data: await res.json().catch(() => null), res };
};

// 1x1 透明 PNG（截图修改测试用，Mock 不解析图片内容）
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

try {
  await ready;
  console.log('server ready');

  // 1. 模板列表（风格预设数据源）
  const tpl = await fetchJson('/api/templates');
  assert(tpl.status === 200 && tpl.data.templates.length > 0, `GET /api/templates (${tpl.data?.templates?.length} 个预设)`);

  // 2. 生成：多变体 + 风格预设
  const style = tpl.data.templates[0].id;
  const gen = await fetchJson('/api/draft/generate', {
    method: 'POST', body: { prompt: '做一个深色科技感的 SaaS 定价页', variants: 2, style },
  });
  assert(gen.status === 200 && gen.data.drafts.length === 2, `POST /api/draft/generate variants=2 style=${style} -> ${gen.data?.drafts?.length} 个`);

  // 3. 列表
  const list = await fetchJson('/api/drafts');
  assert(list.status === 200 && list.data.drafts.length >= 2, `GET /api/drafts (${list.data?.drafts?.length} 条)`);

  // 4. 详情
  const id = gen.data.drafts[0].id;
  const one = await fetchJson(`/api/draft/${id}`);
  assert(one.status === 200
    && /<!doctype html>/i.test(one.data.html)
    && /data-did=/.test(one.data.html), 'GET /api/draft/:id（含 <!doctype html> 与 data-did）');

  // 5. 对话迭代（M2）
  const iter = await fetchJson(`/api/draft/${id}/iterate`, {
    method: 'POST', body: { instruction: '导航栏改成毛玻璃' },
  });
  assert(iter.status === 200 && iter.data.version === 2, `POST /iterate -> v${iter.data?.version}`);

  // 6. 点选元素局部修改（M3）
  const did = /data-did="(\d+)"/.exec(one.data.html)[1];
  const ee = await fetchJson(`/api/draft/${id}/edit-element`, {
    method: 'POST', body: { did, instruction: '换成描边样式' },
  });
  assert(ee.status === 200, `POST /edit-element did=${did} -> v${ee.data?.version}`);

  // 7. 截图修改（M5）：截图 + 指令 -> 新版本
  const imgEdit = await fetchJson(`/api/draft/${id}/edit-by-image`, {
    method: 'POST', body: { image: TINY_PNG, instruction: '改成深色模式' },
  });
  assert(imgEdit.status === 200, `POST /edit-by-image -> v${imgEdit.data?.version}`);

  // 8. 版本回退
  const rb = await fetchJson(`/api/draft/${id}/rollback`, { method: 'POST', body: { v: 1 } });
  assert(rb.status === 200 && rb.data.version === 1, `POST /rollback -> v${rb.data?.version}`);

  // 9. 导出 HTML（M4）
  const exp = await fetch(`http://127.0.0.1:${port}/api/draft/${id}/export`);
  assert(exp.status === 200 && /text\/html/.test(exp.headers.get('content-type')), 'GET /export（text/html 附件）');

  // 10. 静态根返回新编辑器
  const root = await fetch(`http://127.0.0.1:${port}/`);
  const rootHtml = await root.text();
  assert(root.status === 200 && /drafts-app\.js/.test(rootHtml), 'GET /（drafts.html 入口）');
} catch (e) {
  console.error('SMOKE ERROR:', e.message);
  failures++;
} finally {
  server.kill('SIGTERM');
  await fs.promises.rm(draftsDir, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0 ? '\nSMOKE PASS (draft mode M1-M5)' : `\nSMOKE FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
