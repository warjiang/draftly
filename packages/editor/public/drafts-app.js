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
async function selectDraft(id, v = null) {
  const qs = v ? `?v=${v}` : '';
  try {
    current = await api(`/api/draft/${encodeURIComponent(id)}${qs}`);
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
