/**
 * ui-components.js — component-registry 中组件的可渲染实现（preview-server 内置）。
 * 路由 /components/ui/<name>.js 由此生成 ES module 源码，接口与真 React 组件同名导出。
 * 离线降级：不依赖 shadcn 源码，用 h() + __ui.css 近似其视觉形态。
 */

const HEADER = `import { h, Fragment } from '/__runtime.js';\nconst __cx = (...xs) => xs.filter(Boolean).join(' ');\n`;

/** 简单代理组件：转发到 DOM 标签 + 类名前缀 */
function simple(name, tag, cls, extra = '') {
  return `${HEADER}
export function ${name}(props = {}) {
  const { className, children, ...rest } = props;
  return h(${JSON.stringify(tag)}, { class: __cx(${JSON.stringify(cls)}, className), ...rest }, children);
}
${extra}`;
}

const MODULES = {
  button: simple('Button', 'button', "['draftly-btn', 'draftly-btn-' + (props.variant || 'default'), props.size && props.size !== 'default' ? 'draftly-btn-' + props.size : ''].filter(Boolean).join(' ')")
    .replace('(props.variant', '(props.variant'), // 保持可读，逻辑已在 cls 表达式中
  input: `${HEADER}
export function Input(props = {}) {
  const { className, children, ...rest } = props;
  return h('input', { class: __cx('draftly-input', className), ...rest });
}
`,
  textarea: `${HEADER}
export function Textarea(props = {}) {
  const { className, children, ...rest } = props;
  return h('textarea', { class: __cx('draftly-input', className), ...rest }, children);
}
`,
  label: simple('Label', 'label', "'draftly-label'"),
  card: simple('Card', 'div', "'draftly-card'"),
  dialog: `${HEADER}
export function Dialog(props = {}) {
  const { className, children, ...rest } = props;
  return h('div', { class: __cx('draftly-dialog', className), role: 'dialog', ...rest }, children);
}
`,
  tabs: `${HEADER}
export function Tabs(props = {}) {
  const { className, children, items = ['Tab 1', 'Tab 2'], ...rest } = props;
  return h('div', { class: __cx('draftly-tabs', className), ...rest },
    h('div', { class: 'draftly-tabs-list' },
      items.map((t, i) => h('button', { class: 'draftly-tab', ...(i === 0 ? { 'data-active': '1' } : {}) }, t))),
    h('div', { class: 'draftly-tabs-panel' }, children));
}
`,
  badge: simple('Badge', 'span', "'draftly-badge'"),
  avatar: `${HEADER}
export function Avatar(props = {}) {
  const { className, children, fallback = 'U', ...rest } = props;
  return h('span', { class: __cx('draftly-avatar', className), ...rest }, children || fallback);
}
`,
  separator: `${HEADER}
export function Separator(props = {}) {
  const { className, ...rest } = props;
  return h('hr', { class: __cx('draftly-sep', className), ...rest });
}
`,
  alert: simple('Alert', 'div', "'draftly-alert'"),
  table: simple('Table', 'table', "'draftly-table'"),
  switch: `${HEADER}
export function Switch(props = {}) {
  const { className, checked, ...rest } = props;
  return h('span', { class: __cx('draftly-switch', className), ...(checked ? { 'data-on': '1' } : {}), role: 'switch', ...rest });
}
`,
  checkbox: `${HEADER}
export function Checkbox(props = {}) {
  const { className, label, ...rest } = props;
  return h('label', { class: __cx('draftly-checkbox', className) },
    h('input', { type: 'checkbox', ...rest }), label ? ' ' + label : null);
}
`,
  radio: `${HEADER}
export function Radio(props = {}) {
  const { className, label, ...rest } = props;
  return h('label', { class: __cx('draftly-radio', className) },
    h('input', { type: 'radio', ...rest }), label ? ' ' + label : null);
}
`,
  select: `${HEADER}
export function Select(props = {}) {
  const { className, options = ['Option 1', 'Option 2'], ...rest } = props;
  return h('select', { class: __cx('draftly-input', className), ...rest },
    options.map((o) => h('option', null, o)));
}
`,
  progress: `${HEADER}
export function Progress(props = {}) {
  const { className, value = 50, ...rest } = props;
  return h('div', { class: __cx('draftly-progress', className), style: { background: '#e8e8e3', borderRadius: '999px', height: '8px', overflow: 'hidden' }, ...rest },
    h('div', { style: { width: value + '%', height: '100%', background: '#3f4a5a', borderRadius: '999px' } }));
}
`,
  tooltip: simple('Tooltip', 'span', "'draftly-badge'"),
  accordion: `${HEADER}
export function Accordion(props = {}) {
  const { className, children, title = 'Section', ...rest } = props;
  return h('details', { class: __cx('draftly-accordion', className), ...rest },
    h('summary', { style: { cursor: 'pointer', fontWeight: '500' } }, title),
    h('div', { style: { paddingTop: '8px' } }, children));
}
`,
  breadcrumb: `${HEADER}
export function Breadcrumb(props = {}) {
  const { className, items = ['Home', 'Page'], ...rest } = props;
  return h('nav', { class: __cx('draftly-breadcrumb', className), style: { fontSize: '13px', color: '#6a6a64' }, ...rest },
    items.map((it, i) => h(Fragment, null,
      i > 0 ? ' / ' : '',
      h('span', i === items.length - 1 ? { style: { color: '#2e2e2c' } } : null, it))));
}
`,
};

// button 模块的 cls 是表达式，重写为更稳妥的完整实现
MODULES.button = `${HEADER}
export function Button(props = {}) {
  const { className, children, variant = 'default', size, ...rest } = props;
  const cls = __cx('draftly-btn', 'draftly-btn-' + variant, size && size !== 'default' ? 'draftly-btn-' + size : '', className);
  return h('button', { class: cls, ...rest }, children);
}
`;

/** 返回内置组件模块源码；未知组件名返回 null */
export function getComponentModuleSource(name) {
  return MODULES[name] || null;
}

export function listBuiltinComponents() {
  return Object.keys(MODULES);
}
