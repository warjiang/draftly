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

/** 生成默认 DESIGN.md 全文（可在生成时被风格预设覆盖） */
export function defaultDesignMd(overrides = {}) {
  const base = {
    name: 'default-theme',
    colors: {
      background: '#f4f1ea',
      surface: '#ffffff',
      primary: '#347b69',
      text: '#272521',
      muted: '#716d64',
      border: '#ded9cf',
      accent: '#dceae4',
      destructive: '#b65045',
    },
    typography: {
      fontFamily: '"Geist Variable", "PingFang SC", "Microsoft YaHei", sans-serif',
      scale: { h1: '56px', h2: '36px', h3: '22px', body: '16px', small: '13px' },
    },
    spacing: { unit: '8px', scale: ['4px', '8px', '16px', '24px', '40px', '64px', '96px'] },
    radius: { sm: '8px', md: '14px', full: '999px' },
    shadows: {
      sm: '0 1px 2px rgba(39,37,33,0.06)',
      md: '0 14px 34px rgba(39,37,33,0.09)',
      lg: '0 30px 70px rgba(39,37,33,0.13)',
    },
    motion: { duration: '220ms', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    components: {
      Button: { radius: 'md', primaryVariant: 'default' },
      Card: { surface: 'surface', border: 'optional', shadow: 'contextual' },
    },
    antiPatterns: [
      'no-blue-purple-gradient',
      'no-one-off-hex-colors',
      'no-three-equal-card-row',
      'no-everything-centered',
      'no-placeholder-copy',
      'no-layout-property-animation',
    ],
  };
  const meta = deepMerge(base, overrides);
  const body = `# DESIGN.md — ${meta.name}

## 设计原则
- 先从产品目标、内容密度和用户任务推导布局，不套用固定营销页模板。
- 严格使用 colors、typography、spacing、radius、shadows 与 motion token；不要散落一次性值。
- 优先组合项目内的 shadcn/ui 组件。只有现有 primitive 无法表达时才创建产品组件。
- 页面必须有清晰的一读层级和至少一个克制的二读细节，避免所有区域同权、同宽、同圆角。

## 颜色（colors）
- primary 用于主要行动点（主按钮、链接、强调）；background/surface 区分页面与卡片底色。
- muted 用于次要文本；destructive 仅用于错误与危险操作。单页只保留一个主强调色。
- 所有中性色保持一致色温，阴影也应继承 text/background 的色相，不使用通用纯黑阴影。

## 字体（typography）
- 全局字体 fontFamily；标题用 typography.scale 的 h1–h3，正文 body，辅助信息 small。
- 大标题收紧字距与行高并使用 text-wrap: balance；正文宽度控制在约 65 个字符并使用 text-wrap: pretty。
- 数据、版本号和时间使用等宽字体或 tabular-nums。

## 间距与圆角（spacing / radius）
- 所有 margin/padding 取 spacing.scale 中的值（unit 的倍数）。
- 外层容器、卡片和内部控件采用不同圆角层级；不要让每个元素都变成胶囊。
- 页面使用明确的 max-width；桌面与移动端都需要单独校准留白和信息顺序。

## 阴影与动效（shadows / motion）
- 只有需要表达层级时才使用阴影；普通内容优先靠背景、留白或单侧分隔建立层次。
- hover、press、focus、面板进入和列表加载使用 motion.duration + motion.easing。
- 动画只改变 transform 与 opacity，并为 prefers-reduced-motion 提供静态退化。

## 组件约定（components）
- Button 使用内置 variant/size；图标按钮必须有可访问名称，图标放在文字前后时使用 data-icon。
- 表单使用 Field/FieldGroup，反馈使用 Alert，空状态使用 Empty，加载使用 Skeleton。
- Dialog/Sheet 必须有 Title；选择项必须位于对应 Group 中；不要用原生 alert/confirm。
- Card 只用于确实需要分组或抬升的内容，并使用完整的 Header/Content/Footer 组合。

## 反模式（antiPatterns）
${meta.antiPatterns.map((a) => `- ${a}`).join('\n')}

## 布局约定
- 使用 1200–1440px 的内容容器，并根据产品类型选择不对称网格、主次分栏或编辑式留白。
- 禁止默认采用“三张等宽卡片 + 居中标题”；内容差异必须反映在尺寸、位置或层级上。
- 使用 CSS Grid 处理主布局，避免复杂百分比 flex 计算；全屏区域使用 min-height: 100dvh。

## 内容与状态
- 使用用户语言编写真实、具体的产品文案，不使用 Lorem Ipsum、John Doe 或泛化 AI 营销词。
- 实现 hover、active、focus-visible、disabled、loading、empty 与 error 状态；错误直接说明发生了什么和下一步。
- 所有页面提供可理解的返回/退出路径，交互控件支持键盘操作，图片包含有效 alt。`;
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
