/**
 * drafts-app.js — 设计草稿编辑器前端（M1）
 * 一句话 → POST /api/draft/generate（1~3 个变体）→ 草稿列表 → srcdoc 预览。
 * 与旧版编辑器（index.html / app.js）完全独立，不依赖 sandbox preview。
 */
const $ = (sel) => document.querySelector(sel);
const preview = $('#preview');

let drafts = [];      // meta 列表
let current = null;   // { meta, html, version }

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
async function selectDraft(id) {
  try {
    current = await api(`/api/draft/${encodeURIComponent(id)}`);
  } catch (e) {
    alert('加载草稿失败：' + e.message);
    return;
  }
  $('#stage-empty').hidden = true;
  $('#stage-view').hidden = false;
  $('#stage-title').textContent = current.meta.title;
  $('#stage-meta').textContent = `${current.meta.prompt} · v${current.version}`;
  preview.srcdoc = current.html;
  renderList();
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
    const { drafts: created } = await api('/api/draft/generate', {
      body: { prompt, variants: Number($('#gen-variants').value) },
    });
    $('#gen-input').value = '';
    await loadDrafts();
    if (created.length) await selectDraft(created[0].id);
  } catch (err) {
    alert('生成失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成草稿';
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
loadDrafts();
