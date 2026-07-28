/**
 * preview-runtime.js — 浏览器端微型渲染 runtime（~100 行，不依赖真 React）。
 * 由 preview-server 在 /__runtime.js 路由 serve。
 * jsx.js 把 JSX 子集转译为 h() 调用，本模块负责挂载成真实 DOM。
 */

export const RUNTIME_SOURCE = `
export const Fragment = Symbol('Fragment');

export function h(tag, props, ...children) {
  return { tag, props: props || {}, children: children.flat(Infinity) };
}

function mount(node) {
  if (node === null || node === undefined || node === false || node === true) {
    return document.createTextNode('');
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return document.createTextNode(String(node));
  }
  if (Array.isArray(node)) {
    const frag = document.createDocumentFragment();
    for (const c of node) frag.appendChild(mount(c));
    return frag;
  }
  const { tag, props, children } = node;
  if (tag === Fragment) {
    const frag = document.createDocumentFragment();
    for (const c of children) frag.appendChild(mount(c));
    return frag;
  }
  if (typeof tag === 'function') {
    return mount(tag({ ...props, children }));
  }
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'className') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        el.style[sk.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = sv;
      }
    } else if (/^on[A-Z]/.test(k) && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) el.appendChild(mount(c));
  return el;
}

export function render(vnode, container) {
  container.innerHTML = '';
  container.appendChild(mount(vnode));
}
`;

/** index.html 外壳：HMR-lite (EventSource) + inspect 脚本注入点（Phase 2 填充） */
export const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>draftly preview</title>
<link rel="stylesheet" href="/__ui.css" />
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/App.jsx"></script>
<script>
// HMR-lite：preview-server 监听文件变更，经 EventSource 推送，整页刷新。
// （Phase 1 降级方案；真正的模块热替换在引入 vite 后自然获得）
(function () {
  try {
    var es = new EventSource('/__hmr');
    es.onmessage = function (ev) {
      if (ev.data === 'reload') window.location.reload();
    };
  } catch (e) { /* 无 HMR 环境静默降级 */ }
})();
</script>
<!-- INSPECT_INJECTION_POINT: inspect 脚本（hover 高亮 / 点选 / postMessage 回传，Phase 2 已实现） -->
<script src="/__inspect.js"></script>
</body>
</html>
`;

/**
 * inspect 脚本（Phase 2 完整实现，SPEC 2.3）。
 * 注入到 preview index.html（非 module，兼容任意宿主页面；同源 /preview 与跨域 bridge 均可用）。
 * 协议见 packages/shared/src/inspect.js：
 *   父 → iframe: { type: 'draftly:inspect:set', enabled }      （编辑器开关）
 *   iframe → 父: { type: 'draftly:inspect:select', payload }   （点选回传）
 * 安全说明：postMessage 目标 origin 用 '*'，仅在 inspect 启用且用户点选时发送；
 * payload 只含元素元数据（loc/tag/class/文本/关键计算样式），不含敏感信息。
 */
export const INSPECT_SOURCE = `
(function () {
  'use strict';
  var SET = 'draftly:inspect:set';
  var SELECT = 'draftly:inspect:select';
  var STYLE_KEYS = ['color', 'fontSize', 'fontFamily', 'backgroundColor',
    'borderRadius', 'padding', 'margin'];
  var state = { enabled: false, selected: null };

  /* hover 高亮浮层（不拦截事件） */
  var overlay = document.createElement('div');
  overlay.setAttribute('data-draftly-inspect-overlay', '');
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;' +
    'outline:2px solid #e88f4d;outline-offset:1px;background:rgba(232,143,77,.08);display:none;';
  (document.body || document.documentElement).appendChild(overlay);

  function showOverlay(el) {
    if (!el || !el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }
  function hideOverlay() { overlay.style.display = 'none'; }

  function closestLoc(el) {
    while (el && el !== document.documentElement) {
      if (el.getAttribute && el.getAttribute('data-source-loc')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function buildPayload(el) {
    var cs = window.getComputedStyle(el);
    var styles = {};
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      styles[STYLE_KEYS[i]] = String(cs[STYLE_KEYS[i]] || '');
    }
    return {
      loc: el.getAttribute('data-source-loc'),
      tagName: el.tagName.toLowerCase(),
      className: typeof el.className === 'string' ? el.className : '',
      textContent: (el.textContent || '').trim().slice(0, 120),
      computedStyles: styles,
    };
  }

  function onHover(e) {
    if (!state.enabled) return;
    var el = closestLoc(e.target);
    if (el) showOverlay(el); else hideOverlay();
  }

  function onClick(e) {
    if (!state.enabled) return;
    var el = closestLoc(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    state.selected = el;
    showOverlay(el);
    var msg = { type: SELECT, payload: buildPayload(el) };
    // '*'：inspect 模式下的有意放宽（跨域 bridge 场景父窗口 origin 不可预知）
    if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
    else window.postMessage(msg, '*'); // 顶层直开 preview 时便于调试
  }

  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('mouseleave', hideOverlay, true);
  window.addEventListener('scroll', function () {
    if (state.enabled && state.selected) showOverlay(state.selected);
  }, true);

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (d && d.type === SET && typeof d.enabled === 'boolean') {
      state.enabled = d.enabled;
      if (!d.enabled) { hideOverlay(); state.selected = null; }
    }
  });

  window.__DRAFTLY_INSPECT__ = { version: 2, state: state };
})();
`;

/** @deprecated Phase 1 占位名保留，避免旧引用断裂 */
export const INSPECT_STUB = INSPECT_SOURCE;

/** 内置 UI 组件基础样式（对应 component-registry 的可渲染实现，浅色低饱和） */
export const UI_CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: #f7f7f5; color: #2e2e2c; line-height: 1.6; }
.draftly-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border-radius: 8px; border: 1px solid transparent; padding: 8px 18px; font-size: 14px;
  cursor: pointer; transition: background .15s ease; }
.draftly-btn-default { background: #3f4a5a; color: #fff; }
.draftly-btn-default:hover { background: #333c49; }
.draftly-btn-destructive { background: #b4544a; color: #fff; }
.draftly-btn-outline { background: transparent; border-color: #c9c9c4; color: #2e2e2c; }
.draftly-btn-secondary { background: #e8e8e3; color: #2e2e2c; }
.draftly-btn-ghost { background: transparent; color: #3f4a5a; }
.draftly-btn-link { background: none; color: #4a6a8a; text-decoration: underline; padding: 0; }
.draftly-btn-sm { padding: 4px 12px; font-size: 13px; }
.draftly-btn-lg { padding: 12px 26px; font-size: 16px; }
.draftly-card { background: #fff; border: 1px solid #e6e6e1; border-radius: 12px; padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,.05); }
.draftly-input { width: 100%; padding: 9px 12px; border: 1px solid #d4d4cf; border-radius: 8px;
  font-size: 14px; background: #fff; color: inherit; }
.draftly-input:focus { outline: 2px solid #aebfcf; border-color: transparent; }
.draftly-label { display: block; font-size: 13px; color: #6a6a64; margin-bottom: 6px; }
.draftly-dialog { background: #fff; border-radius: 12px; padding: 28px; max-width: 420px;
  margin: 10vh auto; box-shadow: 0 8px 30px rgba(0,0,0,.12); }
.draftly-tabs-list { display: flex; gap: 4px; border-bottom: 1px solid #e6e6e1; margin-bottom: 16px; }
.draftly-tab { padding: 8px 16px; font-size: 14px; color: #6a6a64; border: none; background: none;
  cursor: pointer; border-bottom: 2px solid transparent; }
.draftly-tab[data-active] { color: #2e2e2c; border-bottom-color: #3f4a5a; }
.draftly-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
  background: #e8ecef; color: #3f4a5a; }
.draftly-avatar { width: 36px; height: 36px; border-radius: 50%; background: #cfd8dc;
  display: inline-flex; align-items: center; justify-content: center; font-size: 13px; color: #455a64; }
.draftly-sep { border: none; border-top: 1px solid #e6e6e1; margin: 16px 0; }
.draftly-alert { border: 1px solid #e3d9b8; background: #faf6e8; color: #6b5d2f;
  border-radius: 8px; padding: 12px 16px; font-size: 14px; }
.draftly-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.draftly-table th, .draftly-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #ecece7; }
.draftly-table th { color: #6a6a64; font-weight: 500; }
.draftly-switch { width: 40px; height: 22px; border-radius: 999px; background: #d4d4cf; position: relative;
  display: inline-block; cursor: pointer; }
.draftly-switch[data-on] { background: #3f4a5a; }
.draftly-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: left .15s; }
.draftly-switch[data-on]::after { left: 21px; }
`;
