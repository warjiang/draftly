/**
 * design-md.js — DESIGN.md 解析/序列化（SPEC 2.1）
 * 格式：YAML 子集 frontmatter（--- 包裹，map/列表/标量/2 空格缩进嵌套）+ Markdown body。
 * 零依赖：自实现 mini-YAML 子集解析器，覆盖 DESIGN.md 所需的结构（颜色/字体/间距 token）。
 */

/** 解析 DESIGN.md 全文 → { meta, body } */
export function parseDesignMd(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content || '');
  if (!m) return { meta: {}, body: (content || '').trim() };
  return { meta: parseYamlSubset(m[1]), body: m[2].trim() };
}

/** 序列化 meta + body → DESIGN.md 全文 */
export function serializeDesignMd(meta, body) {
  const yaml = toYaml(meta);
  return `---\n${yaml}---\n\n${(body || '').trim()}\n`;
}

/** 生成默认 DESIGN.md 全文（浅色低饱和基调，可在生成时被覆盖） */
export function defaultDesignMd(overrides = {}) {
  const base = {
    name: 'default-theme',
    colors: {
      background: '#f7f7f5',
      surface: '#ffffff',
      primary: '#3f4a5a',
      text: '#2e2e2c',
      muted: '#6a6a64',
      border: '#e6e6e1',
      accent: '#8fa3b8',
      destructive: '#b4544a',
    },
    typography: {
      fontFamily: '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      scale: { h1: '32px', h2: '24px', h3: '18px', body: '14px', small: '13px' },
    },
    spacing: { unit: '8px', scale: ['4px', '8px', '16px', '24px', '40px'] },
    radius: { sm: '8px', md: '12px', full: '999px' },
    shadows: { sm: '0 1px 2px rgba(0,0,0,0.06)', md: '0 4px 12px rgba(0,0,0,0.08)', lg: '0 12px 32px rgba(0,0,0,0.12)' },
    motion: { duration: '150ms', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    components: {
      Button: { radius: 'md', primaryVariant: 'default' },
      Card: { surface: 'surface', border: 'border', shadow: 'sm' },
    },
    antiPatterns: ['no-blue-purple-gradient', 'no-one-off-hex-colors', 'no-inline-px-outside-scale'],
  };
  const meta = deepMerge(base, overrides);
  const body = `# DESIGN.md — ${meta.name}

## 设计原则
- 浅色、低饱和、留白充分；不使用蓝紫渐变。
- 颜色一律使用 colors token；字号使用 typography.scale；间距为 spacing.unit 的倍数。
- 组件优先取自 component-registry，不要手写一次性样式。

## 颜色（colors）
- primary 用于主要行动点（主按钮、链接、强调）；background/surface 区分页面与卡片底色。
- muted 用于次要文本；destructive 仅用于危险操作。

## 字体（typography）
- 全局字体 fontFamily；标题用 typography.scale 的 h1–h3，正文 body，辅助信息 small。

## 间距与圆角（spacing / radius）
- 所有 margin/padding 取 spacing.scale 中的值（unit 的倍数）。
- 卡片/输入框圆角 radius.md，胶囊元素 radius.full。

## 阴影与动效（shadows / motion）
- 浮层用 shadows.md/sm，弹窗用 shadows.lg；避免厚重投影。
- 过渡统一 motion.duration + motion.easing，不做花哨动画。

## 组件约定（components）
- Button 主行动用 primaryVariant；Card 使用 surface + border + shadows.sm。

## 反模式（antiPatterns）
${meta.antiPatterns.map((a) => `- ${a}`).join('\n')}

## 布局约定
- 页面容器 max-width 720–1100px，居中，padding 40px。
- 卡片表面色 surface，圆角 radius.md，细边框 border。`;
  return serializeDesignMd(meta, body);
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const REQUIRED_COLORS = ['primary', 'background', 'surface', 'text', 'muted', 'border'];

/**
 * 校验 DESIGN.md 全文（SPEC Phase 3）。
 * 必填：front matter + meta.name + colors（6 个核心 token，合法 hex）
 *       + typography.fontFamily + typography.scale + spacing.unit + radius
 * @param {string} content DESIGN.md 全文
 * @returns {string[]} 错误列表，空数组 = 通过
 */
export function validateDesignMd(content) {
  const errors = [];
  if (typeof content !== 'string' || !content.trim()) return ['DESIGN.md 内容为空'];
  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(content)) {
    errors.push('缺少 YAML front matter（--- 包裹）');
    return errors;
  }
  let meta;
  try { ({ meta } = parseDesignMd(content)); } catch (e) {
    errors.push(`front matter 解析失败: ${e.message}`);
    return errors;
  }
  if (!meta.name || typeof meta.name !== 'string') errors.push('meta.name 必填（字符串）');

  if (!meta.colors || typeof meta.colors !== 'object') {
    errors.push('meta.colors 必填（对象）');
  } else {
    for (const key of REQUIRED_COLORS) {
      const v = meta.colors[key];
      if (v === undefined) errors.push(`colors.${key} 缺失`);
      else if (typeof v !== 'string' || !HEX_RE.test(v)) errors.push(`colors.${key} 不是合法 hex 颜色: ${v}`);
    }
    for (const [k, v] of Object.entries(meta.colors)) {
      if (typeof v === 'string' && !HEX_RE.test(v)) errors.push(`colors.${k} 不是合法 hex 颜色: ${v}`);
    }
  }

  if (!meta.typography || typeof meta.typography !== 'object') {
    errors.push('meta.typography 必填（对象）');
  } else {
    if (!meta.typography.fontFamily) errors.push('typography.fontFamily 缺失');
    if (!meta.typography.scale || typeof meta.typography.scale !== 'object' || !meta.typography.scale.body) {
      errors.push('typography.scale 缺失或不含 body');
    }
  }

  if (!meta.spacing || typeof meta.spacing !== 'object') {
    errors.push('meta.spacing 必填（对象）');
  } else if (!/^\d+px$/.test(String(meta.spacing.unit || ''))) {
    errors.push(`spacing.unit 必须是 "<n>px": ${meta.spacing.unit}`);
  }

  if (!meta.radius || typeof meta.radius !== 'object' || !meta.radius.md) {
    errors.push('meta.radius 缺失或不含 md');
  }
  return errors;
}

/* ---------- mini YAML 子集（map / list / 标量，缩进嵌套） ---------- */

function parseYamlSubset(src) {
  const lines = src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const indent = line.match(/^ */)[0].length;
    const text = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (text.startsWith('- ')) {
      if (!Array.isArray(parent)) throw new Error('YAML subset: list item under non-list');
      parent.push(parseScalar(text.slice(2).trim()));
      continue;
    }
    const kv = /^([^:]+):\s*(.*)$/.exec(text);
    if (!kv) throw new Error(`YAML subset: bad line: ${text}`);
    const [, key, val] = kv;
    if (val === '') {
      // 下一块是 list 还是 map？看下一行
      const next = lines[li + 1];
      const container = next && next.trim().startsWith('- ') ? [] : {};
      parent[key.trim()] = container;
      stack.push({ indent, obj: container });
    } else {
      parent[key.trim()] = parseScalar(val);
    }
  }
  return root;
}

function parseScalar(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v.replace(/^['"]|['"]$/g, '');
}

function toYaml(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      out += `${pad}${k}:\n`;
      for (const item of v) out += `${pad}  - ${formatScalar(item)}\n`;
    } else if (v && typeof v === 'object') {
      out += `${pad}${k}:\n${toYaml(v, indent + 2)}`;
    } else {
      out += `${pad}${k}: ${formatScalar(v)}\n`;
    }
  }
  return out;
}

function formatScalar(v) {
  if (typeof v === 'string' && /[:#]|^\s|\s$/.test(v)) return JSON.stringify(v);
  return String(v);
}

function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object' || !a || !b) {
    return b === undefined ? a : b;
  }
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a[k], v);
  return out;
}
