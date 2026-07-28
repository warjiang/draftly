import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

test('编辑器资源完整：三栏布局 + API 端点引用', () => {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  // 三栏 + 代码 Tab + undo/redo + 生成框
  assert.match(html, /id="panel-components"/);
  assert.match(html, /id="preview"[^>]*src="\/preview\/"/);
  assert.match(html, /id="panel-props"/);
  assert.match(html, /id="code-tab"/);
  assert.match(html, /id="btn-undo"/);
  assert.match(html, /id="btn-redo"/);
  assert.match(html, /id="gen-form"/);
  const app = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
  for (const ep of ['/api/registry', '/api/generate', '/api/patch', '/api/insert',
    '/api/history/undo', '/api/history/redo', '/api/file?path=src/App.jsx', '/api/sandbox/start']) {
    assert.ok(app.includes(ep), `app.js missing ${ep}`);
  }
  const css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');
  assert.match(css, /grid-template-columns: 220px 1fr 280px/);
  assert.doesNotMatch(css, /gradient/i); // 无渐变（设计红线）
});

test('Phase 2：Inspect 模式开关 + postMessage 协议接线', () => {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  assert.match(html, /id="btn-inspect"/);
  assert.match(html, /id="sel-class"/);
  assert.match(html, /id="sel-styles"/);
  const app = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
  assert.ok(app.includes("from '/shared/inspect.js'"), 'app.js must import shared protocol');
  assert.match(app, /postMessage\(\{ type: INSPECT_MSG_SET, enabled: on \}/);
  assert.match(app, /parseSelectMessage\(e\.data\)/);
});

test('Phase 2.3：自然语言指令输入框接线', () => {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  assert.match(html, /id="nl-instruction"/);
  assert.match(html, /id="apply-nl"/);
  const app = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
  assert.ok(app.includes('/api/nl-edit'));
  assert.match(app, /instruction/);
});

test('Phase 3.3：模板库 Tab（色板预览/筛选/一键应用）接线', () => {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  assert.match(html, /id="tab-templates"/);
  assert.match(html, /id="pane-templates"/);
  assert.match(html, /id="template-grid"/);
  assert.match(html, /id="tpl-filter-style"/);
  assert.match(html, /id="tpl-filter-color"/);
  const app = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
  assert.ok(app.includes('/api/templates'), 'app.js missing /api/templates');
  assert.ok(app.includes('/api/templates/apply'), 'app.js missing /api/templates/apply');
  assert.match(app, /tpl-swatches/);            // 色块替代截图
  assert.match(app, /renderTemplates/);
  const css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');
  assert.match(css, /\.tpl-grid/);
  assert.match(css, /\.tpl-swatches/);
  assert.doesNotMatch(css, /gradient/i);       // 无渐变红线仍成立
});
