/**
 * app.js — 编辑器前端（无构建 SPA，原生 ES module）。
 * 三栏：组件面板 / iframe 预览（/preview/ 同源代理）/ 属性面板；底部代码 Tab；Undo/Redo。
 *
 * Phase 2：inspect 走 preview-server 注入的 /__inspect.js + postMessage 协议
 * （协议 schema 见 /shared/inspect.js，跨域 target 同样适用；替换 Phase 1 的同源直连方案）。
 * 拖拽落地：drop 到 iframe 时调 /api/insert，由服务端把片段插入根容器末尾。
 */
import { INSPECT_MSG_SET, parseSelectMessage } from '/shared/inspect.js';

const $ = (sel) => document.querySelector(sel);
const iframe = $('#preview');

async function api(p, opts = {}) {
  const res = await fetch(p, opts.body !== undefined ? {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function refreshPreview() {
  try { iframe.contentWindow.location.reload(); } catch { iframe.src = iframe.src; }
  loadCode();
}

async function loadCode() {
  try {
    const { content } = await api('/api/file?path=src/App.jsx');
    $('#code-view').textContent = content;
  } catch (e) { $('#code-view').textContent = '// ' + e.message; }
}

async function refreshHistoryButtons() {
  const h = await api('/api/history').catch(() => ({ canUndo: false, canRedo: false }));
  $('#btn-undo').disabled = !h.canUndo;
  $('#btn-redo').disabled = !h.canRedo;
}

async function refreshStatus() {
  const s = await api('/api/sandbox/status').catch(() => ({ running: false }));
  $('#sandbox-status').textContent = s.running ? `sandbox: :${s.port}` : 'sandbox: stopped';
}

/* ---------- 组件面板 ---------- */
async function loadComponents() {
  const { components } = await api('/api/registry');
  const ul = $('#component-list');
  ul.innerHTML = '';
  for (const c of components) {
    const li = document.createElement('li');
    li.draggable = true;
    li.innerHTML = `<div class="name">${c.name}</div><div class="sub">${c.variants?.join(' · ') || ''}</div>`;
    li.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/x-draftly-component', c.name);
    });
    li.addEventListener('click', () => showComponentInfo(c));
    ul.appendChild(li);
  }
}

function showComponentInfo(c) {
  $('#props-empty').hidden = true;
  $('#props-editor').hidden = true;
  $('#comp-info').hidden = false;
  $('#comp-name').textContent = c.name;
  $('#comp-import').textContent = c.import;
  $('#comp-variants').innerHTML = (c.variants || []).map((v) => `<span class="badge">${v}</span>`).join('') || '—';
  $('#comp-props').textContent = Object.entries(c.props || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('|') : v}`).join('\n') || '—';
}

/* ---------- Inspect 模式开关 + postMessage 选择 ---------- */
let inspectOn = false;

function setInspect(on) {
  inspectOn = on;
  $('#btn-inspect').classList.toggle('active', on);
  $('#btn-inspect').setAttribute('aria-pressed', String(on));
  try {
    iframe.contentWindow?.postMessage({ type: INSPECT_MSG_SET, enabled: on }, '*');
  } catch { /* iframe 未就绪 */ }
  if (!on) clearSelection();
}

$('#btn-inspect').addEventListener('click', () => setInspect(!inspectOn));

window.addEventListener('message', (e) => {
  // 协议 schema 校验：非本协议/非法 payload 一律忽略
  const payload = parseSelectMessage(e.data);
  if (payload) showSelection(payload);
});

/* ---------- 属性面板（选中元素） ---------- */
let selected = null; // SelectPayload

function showSelection(p) {
  selected = p;
  $('#props-empty').hidden = true;
  $('#comp-info').hidden = true;
  $('#props-editor').hidden = false;
  $('#sel-tag').textContent = '<' + p.tagName + '>';
  $('#sel-loc').textContent = p.loc;
  $('#sel-class').textContent = p.className || '—';
  $('#sel-text').textContent = p.textContent || '—';
  $('#sel-styles').innerHTML = Object.entries(p.computedStyles)
    .map(([k, v]) => `<div class="row"><dt>${k}</dt><dd class="mono">${v || '—'}</dd></div>`)
    .join('');
  $('#prop-text').value = p.textContent || '';
  $('#patch-msg').textContent = '';
}

function clearSelection() {
  selected = null;
  $('#props-editor').hidden = true;
  $('#comp-info').hidden = true;
  $('#props-empty').hidden = false;
}

async function applyPatch(type, value) {
  if (!selected) return;
  try {
    await api('/api/patch', { body: { loc: selected.loc, type, value } });
    $('#patch-msg').textContent = '已应用 ✓';
    refreshPreview();
    refreshHistoryButtons();
  } catch (e) {
    $('#patch-msg').textContent = '失败：' + e.message;
  }
}

/* ---------- 自然语言改元素（Phase 2 Task 2.3） ---------- */
async function applyNlEdit() {
  if (!selected) return;
  const instruction = $('#nl-instruction').value.trim();
  if (!instruction) return;
  const btn = $('#apply-nl');
  btn.disabled = true; btn.textContent = '应用中…';
  try {
    const r = await api('/api/nl-edit', { body: { loc: selected.loc, instruction } });
    $('#patch-msg').textContent = r.unchanged ? '指令未产生变更' : `已应用 ✓（${r.applied.join('/')}）`;
    $('#nl-instruction').value = '';
    setTimeout(refreshPreview, 250); // HMR-lite：watcher 触发整页刷新；主动兜底
    refreshHistoryButtons();
  } catch (e) {
    $('#patch-msg').textContent = '失败：' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '应用指令';
  }
}
$('#apply-nl').addEventListener('click', applyNlEdit);
$('#nl-instruction').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyNlEdit(); });

$('#apply-text').addEventListener('click', () => applyPatch('text', $('#prop-text').value));
$('#apply-style').addEventListener('click', () => applyPatch('style', {
  color: $('#prop-color').value,
  fontSize: $('#prop-fontsize').value,
}));

/* ---------- iframe：drop（inspect 由注入脚本 + postMessage 承担） ---------- */
function wireIframe() {
  // inspect 开启状态下 iframe 重载后需重新下发开关
  if (inspectOn) setInspect(true);
  const doc = iframe.contentDocument;
  if (!doc) return; // 跨域场景无法直挂 drop，静默降级（inspect 不受影响）
  doc.addEventListener('dragover', (e) => e.preventDefault());
  doc.addEventListener('drop', async (e) => {
    e.preventDefault();
    const name = e.dataTransfer.getData('text/x-draftly-component');
    if (!name) return;
    try {
      await api('/api/insert', { body: { name } });
      setTimeout(refreshPreview, 250); // 等 watcher 触发前主动刷新
      refreshHistoryButtons();
    } catch (err) { alert('插入失败：' + err.message); }
  });
}
iframe.addEventListener('load', () => { wireIframe(); loadCode(); });

/* ---------- 模板库（Phase 3 Task 3.3） ---------- */
let templatesCache = [];

function switchPane(tab) {
  for (const name of ['components', 'templates']) {
    $(`#tab-${name}`).classList.toggle('active', name === tab);
    $(`#pane-${name}`).hidden = name !== tab;
  }
  if (tab === 'templates' && !templatesCache.length) loadTemplates();
}
$('#tab-components').addEventListener('click', () => switchPane('components'));
$('#tab-templates').addEventListener('click', () => switchPane('templates'));

async function loadTemplates() {
  try {
    const { templates } = await api('/api/templates');
    templatesCache = templates;
    // 筛选项：风格 / 颜色（并集去重）
    const fill = (sel, key) => {
      const values = [...new Set(templates.flatMap((t) => t.tags[key] || []))].sort();
      for (const v of values) {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        $(sel).appendChild(opt);
      }
    };
    fill('#tpl-filter-style', 'style');
    fill('#tpl-filter-color', 'color');
    renderTemplates();
  } catch (e) {
    $('#tpl-msg').textContent = '模板加载失败：' + e.message;
  }
}

function renderTemplates() {
  const style = $('#tpl-filter-style').value;
  const color = $('#tpl-filter-color').value;
  const list = templatesCache.filter((t) =>
    (!style || (t.tags.style || []).includes(style)) &&
    (!color || (t.tags.color || []).includes(color)));
  const grid = $('#template-grid');
  grid.innerHTML = '';
  if (!list.length) { grid.innerHTML = '<p class="hint">无匹配模板</p>'; return; }
  const SWATCH_KEYS = ['background', 'surface', 'primary', 'text', 'muted', 'accent'];
  for (const t of list) {
    const card = document.createElement('div');
    card.className = 'tpl-card';
    const swatches = SWATCH_KEYS.map((k) => t.colors[k]).filter(Boolean)
      .map((c) => `<span style="background:${c}" title="${c}"></span>`).join('');
    const tags = [...(t.tags.style || []), ...(t.tags.industry || []), ...(t.tags.color || [])]
      .map((v) => `<span class="badge">${v}</span>`).join('');
    card.innerHTML = `
      <div class="tpl-swatches">${swatches}</div>
      <div class="tpl-name">${t.name}</div>
      <div class="tpl-tags">${tags}</div>
      <div class="tpl-foot">
        <span class="confidence">置信度: ${t.confidence}</span>
        <button class="btn primary tpl-apply">应用</button>
      </div>`;
    card.querySelector('.tpl-apply').addEventListener('click', () => applyTemplate(t));
    grid.appendChild(card);
  }
}
$('#tpl-filter-style').addEventListener('change', renderTemplates);
$('#tpl-filter-color').addEventListener('change', renderTemplates);

async function applyTemplate(t) {
  const msg = $('#tpl-msg');
  msg.textContent = `正在应用「${t.name}」…`;
  try {
    await api('/api/templates/apply', { body: { id: t.id, regenerate: true, prompt: '按照当前设计系统生成一个落地页' } });
    msg.textContent = `已应用「${t.name}」✓（可 Undo 还原）`;
    document.querySelectorAll('.tpl-card').forEach((c) => c.classList.remove('current'));
    setTimeout(refreshPreview, 300);
    refreshHistoryButtons();
  } catch (e) {
    msg.textContent = `应用失败：${e.message}`;
  }
}

/* ---------- 生成 ---------- */
$('#gen-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = $('#gen-input').value.trim();
  if (!prompt) return;
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = '生成中…';
  try {
    await api('/api/generate', { body: { prompt } });
    setTimeout(refreshPreview, 250);
    refreshHistoryButtons();
  } catch (err) { alert('生成失败：' + err.message); }
  finally { btn.disabled = false; btn.textContent = '生成'; }
});

/* ---------- Undo / Redo ---------- */
$('#btn-undo').addEventListener('click', async () => {
  await api('/api/history/undo', { body: {} }).catch(() => {});
  refreshPreview(); refreshHistoryButtons();
});
$('#btn-redo').addEventListener('click', async () => {
  await api('/api/history/redo', { body: {} }).catch(() => {});
  refreshPreview(); refreshHistoryButtons();
});

/* ---------- 启动 ---------- */
(async function init() {
  await api('/api/sandbox/start', { body: {} }).catch(() => {});
  await Promise.all([loadComponents(), loadCode(), refreshHistoryButtons()]);
  refreshStatus();
  setInterval(refreshStatus, 5000);
})();
