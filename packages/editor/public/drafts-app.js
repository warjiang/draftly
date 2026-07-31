/**
 * drafts-app.js — 设计草稿编辑器前端（M1）
 * 一句话 → POST /api/draft/generate（1~3 个变体）→ 草稿列表 → srcdoc 预览。
 * 与旧版编辑器（index.html / app.js）完全独立，不依赖 sandbox preview。
 */
const $ = (sel) => document.querySelector(sel);
const preview = $('#preview');

let drafts = [];      // meta 列表
let current = null;   // { meta, html, version }
let pickMode = false; // 点选修改开关（M3）
let selected = null;  // { did, tagName, textContent }
let image = null;        // 参考截图 dataURL（M5 截图修改）

/* ---------- 点选修改（M3，父侧直挂 contentDocument，无需向 iframe 注入脚本） ---------- */
const HOVER_OUTLINE = '2px dashed rgba(59, 130, 246, .7)';
const SELECT_OUTLINE = '2px solid #3b82f6';
let hoverEl = null;

function clearHover() {
  if (hoverEl) { hoverEl.style.outline = hoverEl.dataset.draftlyPrevOutline || ''; delete hoverEl.dataset.draftlyPrevOutline; }
  hoverEl = null;
}

function clearSelectedStyle() {
  const doc = preview.contentDocument;
  if (!doc) return;
  const prev = doc.querySelector('[data-draftly-selected]');
  if (prev) { prev.style.outline = prev.dataset.draftlyPrevOutline || ''; delete prev.dataset.draftlyPrevOutline; delete prev.dataset.draftlySelected; }
}

function setSelected(el) {
  clearSelectedStyle();
  clearHover();
  if (!el) { selected = null; renderSelected(); return; }
  el.dataset.draftlyPrevOutline = el.style.outline || '';
  el.dataset.draftlySelected = '1';
  el.style.outline = SELECT_OUTLINE;
  selected = {
    did: el.getAttribute('data-did'),
    tagName: el.tagName.toLowerCase(),
    textContent: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
  };
  renderSelected();
}

function renderSelected() {
  $('#selected-empty').hidden = !!selected;
  $('#selected-info').hidden = !selected;
  if (selected) {
    $('#selected-summary').innerHTML =
      `&lt;${escapeHtml(selected.tagName)}&gt; <span class="hint">data-did=${escapeHtml(selected.did)}</span>` +
      (selected.textContent ? `<div class="hint selected-text">${escapeHtml(selected.textContent)}</div>` : '');
  }
}

function bindPickHandlers() {
  const doc = preview.contentDocument;
  if (!doc) return;
  doc.addEventListener('mouseover', (e) => {
    if (!pickMode) return;
    const el = e.target instanceof Element ? e.target.closest('[data-did]') : null;
    if (el === hoverEl) return;
    clearHover();
    if (el && !el.dataset.draftlySelected) {
      el.dataset.draftlyPrevOutline = el.style.outline || '';
      el.style.outline = HOVER_OUTLINE;
      hoverEl = el;
    }
  }, true);
  doc.addEventListener('click', (e) => {
    if (!pickMode) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target instanceof Element ? e.target.closest('[data-did]') : null;
    setSelected(el);
  }, true);
}

function setPickMode(on) {
  pickMode = on;
  $('#btn-pick').classList.toggle('active', on);
  $('#btn-pick').setAttribute('aria-pressed', String(on));
  if (!on) { clearHover(); clearSelectedStyle(); setSelected(null); }
}

$('#btn-pick').addEventListener('click', () => setPickMode(!pickMode));

// srcdoc 每次加载后 document 重建，需要重新挂监听
preview.addEventListener('load', bindPickHandlers);

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 草稿列表 ---------- */
async function loadDrafts() {
  try {
    const { drafts: list } = await api('/api/drafts');
    drafts = list;
  } catch { drafts = []; }
  renderList();
}

function renderList() {
  const ul = $('#draft-list');
  ul.innerHTML = '';
  $('#list-empty').hidden = drafts.length > 0;
  for (const d of drafts) {
    const li = document.createElement('li');
    li.className = 'draft-card' + (current && current.meta.id === d.id ? ' active' : '');
    li.innerHTML = `
      <div class="draft-title">${escapeHtml(d.title)}</div>
      <div class="draft-sub">v${d.versions.length} · ${new Date(d.createdAt).toLocaleString()}</div>`;
    li.addEventListener('click', () => selectDraft(d.id));
    ul.appendChild(li);
  }
}

/* ---------- 预览 ---------- */
async function selectDraft(id, v = null) {
  const qs = v ? `?v=${v}` : '';
  try {
    current = await api(`/api/draft/${encodeURIComponent(id)}${qs}`);
  } catch (e) {
    alert('加载草稿失败：' + e.message);
    return;
  }
  hideCompare(); // 选用方案/切换草稿后退出对比视图
  $('#stage-empty').hidden = true;
  $('#stage-view').hidden = false;
  $('#stage-title').textContent = current.meta.title;
  $('#stage-meta').textContent = `${current.meta.prompt} · v${current.version}`;
  setSelected(null); // 换草稿/版本后原选中元素已失效
  preview.srcdoc = current.html;
  renderList();
  renderVersions();
}

function renderVersions() {
  const ul = $('#version-list');
  ul.innerHTML = '';
  if (!current) return;
  const versions = current.meta.versions.slice().reverse();
  for (const ver of versions) {
    const li = document.createElement('li');
    const isCurrent = ver.v === current.version;
    li.className = 'version-item' + (isCurrent ? ' active' : '');
    const badge = ver.kind === 'iterate' ? '迭代' : '生成';
    const time = new Date(ver.at).toLocaleString();
    li.innerHTML = `
      <div class="version-head">
        <span><span class="version-badge">${badge}</span><span>v${ver.v}</span></span>
        ${!isCurrent ? `<button class="btn btn-small rollback-btn" data-v="${ver.v}">回退</button>` : ''}
      </div>
      <div class="version-sub">${ver.instruction ? escapeHtml(ver.instruction) : time}</div>`;
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('rollback-btn')) {
        e.stopPropagation();
        rollbackVersion(ver.v);
        return;
      }
      if (!isCurrent) selectDraft(current.meta.id, ver.v);
    });
    ul.appendChild(li);
  }
}

async function rollbackVersion(v) {
  if (!current) return;
  if (!confirm(`确定回退到 v${v}？v${v} 之后的版本将被删除。`)) return;
  try {
    await api(`/api/draft/${encodeURIComponent(current.meta.id)}/rollback`, {
      body: { v },
    });
    await loadDrafts();
    await selectDraft(current.meta.id, v);
  } catch (err) {
    alert('回退失败：' + err.message);
  }
}

/* ---------- 生成 ---------- */
$('#gen-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = $('#gen-input').value.trim();
  if (!prompt) return;
  const btn = $('#gen-btn');
  btn.disabled = true;
  btn.textContent = '生成中…';
  try {
    const style = $('#gen-style').value;
    const { drafts: created } = await api('/api/draft/generate', {
      body: { prompt, variants: Number($('#gen-variants').value), ...(style ? { style } : {}) },
    });
    $('#gen-input').value = '';
    await loadDrafts();
    if (created.length > 1) {
      await showCompare(created); // 多变体（M4）：并排对比，点击选用
    } else if (created.length) {
      await selectDraft(created[0].id);
    }
  } catch (err) {
    alert('生成失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成草稿';
  }
});

/* ---------- 风格预设（M4）：模板库 designMd 作为设计契约 ---------- */
async function loadStyles() {
  try {
    const { templates } = await api('/api/templates');
    const sel = $('#gen-style');
    for (const t of templates) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name}（${(t.tags?.style || []).join('/')}）`;
      sel.appendChild(opt);
    }
  } catch { /* 模板库不可用时仅保留「默认风格」 */ }
}

/* ---------- 多变体并排对比（M4） ---------- */
function hideCompare() {
  $('#compare-view').hidden = true;
  $('#compare-grid').innerHTML = '';
}

async function showCompare(created) {
  const grid = $('#compare-grid');
  grid.innerHTML = '';
  $('#stage-empty').hidden = true;
  $('#stage-view').hidden = true;
  $('#compare-view').hidden = false;
  const items = await Promise.all(created.map(async (c, i) => {
    try {
      const d = await api(`/api/draft/${encodeURIComponent(c.id)}`);
      return { ...d, index: i + 1 };
    } catch { return null; }
  }));
  for (const item of items.filter(Boolean)) {
    const card = document.createElement('div');
    card.className = 'compare-card';
    card.innerHTML = `
      <div class="compare-frame-wrap"><iframe sandbox="allow-same-origin" title="方案 ${item.index}"></iframe></div>
      <div class="compare-info">
        <span class="compare-name">方案 ${item.index} · ${escapeHtml(item.meta.title)}</span>
        <span class="hint">点击选用</span>
      </div>`;
    card.querySelector('iframe').srcdoc = item.html;
    card.addEventListener('click', () => selectDraft(item.meta.id));
    grid.appendChild(card);
  }
}

/* ---------- 导出 HTML（M4） ---------- */
$('#btn-export').addEventListener('click', () => {
  if (!current) return;
  const a = document.createElement('a');
  a.href = `/api/draft/${encodeURIComponent(current.meta.id)}/export`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

/* ---------- 元素局部修改（M3） ---------- */
$('#element-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current || !selected) return;
  const instruction = $('#element-input').value.trim();
  if (!instruction) return;
  const btn = $('#element-btn');
  btn.disabled = true;
  btn.textContent = '修改中…';
  try {
    await api(`/api/draft/${encodeURIComponent(current.meta.id)}/edit-element`, {
      body: { did: selected.did, instruction },
    });
    $('#element-input').value = '';
    setSelected(null);
    await loadDrafts();
    await selectDraft(current.meta.id);
  } catch (err) {
    alert('修改失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '修改选中元素';
  }
});

/* ---------- 迭代 ---------- */
$('#iterate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current) return alert('请先选择一个草稿');
  const instruction = $('#iterate-input').value.trim();
  if (!instruction) return;
  const btn = $('#iterate-btn');
  btn.disabled = true;
  btn.textContent = '迭代中…';
  try {
    await api(`/api/draft/${encodeURIComponent(current.meta.id)}/iterate`, {
      body: { instruction },
    });
    $('#iterate-input').value = '';
    await loadDrafts();
    await selectDraft(current.meta.id);
  } catch (err) {
    alert('迭代失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '迭代当前草稿';
  }
});

/* ---------- 截图修改（M5）：粘贴/上传截图 + 指令 -> 修改当前草稿 ---------- */
const imageDrop = $('#image-drop');
const imageFile = $('#image-file');
const imagePreview = $('#image-preview');
const imageDropHint = $('#image-drop-hint');

function setImage(dataUrl) {
  image = dataUrl || null;
  if (image) {
    imagePreview.src = dataUrl;
    imagePreview.hidden = false;
    imageDropHint.hidden = true;
  } else {
    imagePreview.hidden = true;
    imagePreview.src = '';
    imageDropHint.hidden = false;
  }
}

imageDrop.addEventListener('click', () => imageFile.click());
imageDrop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); imageFile.click(); }
});
imageFile.addEventListener('change', () => {
  const f = imageFile.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => setImage(reader.result);
  reader.readAsDataURL(f);
});

// 全局粘贴图片：在任意位置 Ctrl+V 即可填入参考截图
document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      const blob = it.getAsFile();
      if (!blob) continue;
      const reader = new FileReader();
      reader.onload = () => setImage(reader.result);
      reader.readAsDataURL(blob);
      e.preventDefault();
      return;
    }
  }
});

$('#image-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current) return alert('请先选择一个草稿');
  if (!image) return alert('请先粘贴或选择一张截图');
  const instruction = $('#image-input').value.trim();
  if (!instruction) return;
  const btn = $('#image-btn');
  btn.disabled = true;
  btn.textContent = '修改中…';
  try {
    await api(`/api/draft/${encodeURIComponent(current.meta.id)}/edit-by-image`, {
      body: { image, instruction },
    });
    $('#image-input').value = '';
    setImage(null);
    imageFile.value = '';
    await loadDrafts();
    await selectDraft(current.meta.id);
  } catch (err) {
    alert('截图修改失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '按截图修改';
  }
});



/* ---------- 源码弹层 ---------- */
$('#btn-source').addEventListener('click', () => {
  if (!current) return;
  $('#source-view').textContent = current.html;
  $('#source-modal').hidden = false;
});
$('#btn-close-source').addEventListener('click', () => { $('#source-modal').hidden = true; });
$('#source-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});

/* ---------- 启动 ---------- */
loadStyles();
loadDrafts();
