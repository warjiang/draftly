/**
 * design-system.js — 把 DESIGN.md 的 frontmatter 变成可展示的设计资产数据。
 *
 * 纯函数、零 React、零依赖：所有分组、排序、降级和对比度判定都在这里完成，
 * 组件只负责渲染。DESIGN.md 里除 6 个核心颜色 + fontFamily + scale.body +
 * spacing.unit + radius.md 之外的字段都可能缺失，因此每个函数在字段缺失时
 * 返回空数组或 null，由调用方决定是否隐藏整个板块。
 */
import { contrastRatio, hexToRgb, readableOn } from "./design-preview.js";

const COLOR_GROUPS = [
  {
    id: "brand",
    title: "品牌与动作",
    description: "承担主要行动点与状态强调，单页只保留一个主强调色。",
    tokens: ["primary", "accent", "destructive"],
  },
  {
    id: "surface",
    title: "界面与表面",
    description: "区分页面底色、内容表面与分隔线，决定整体明暗与层级。",
    tokens: ["background", "surface", "border"],
  },
  {
    id: "content",
    title: "文字",
    description: "正文与次要信息的可读性基线。",
    tokens: ["text", "muted"],
  },
];

const COLOR_USAGE = {
  primary: "主按钮、链接与选中态",
  accent: "轻强调背景、标签与高亮区域",
  destructive: "错误提示与危险操作",
  background: "页面底色",
  surface: "卡片、面板与浮层表面",
  border: "描边、分隔线与输入框边框",
  text: "正文与标题",
  muted: "辅助说明、占位与次要信息",
};

const TYPE_TOKENS = [
  { token: "h1", label: "一级标题", sample: "把想法编织成产品" },
  { token: "h2", label: "二级标题", sample: "设计系统总览" },
  { token: "h3", label: "三级标题", sample: "组件与状态" },
  { token: "body", label: "正文", sample: "正文用于承载页面的主要信息 Body text 16" },
  { token: "small", label: "辅助文字", sample: "辅助说明与元信息 Caption 13" },
];

const RADIUS_TOKENS = [
  { token: "sm", label: "小圆角", usage: "输入框、标签与紧凑控件" },
  { token: "md", label: "中圆角", usage: "按钮、卡片与面板" },
  { token: "full", label: "全圆角", usage: "头像、徽章与胶囊按钮" },
];

const SHADOW_TOKENS = [
  { token: "sm", label: "轻微抬升", usage: "静态卡片与列表项" },
  { token: "md", label: "浮层", usage: "下拉、气泡与悬停抬升" },
  { token: "lg", label: "对话框", usage: "模态与全局浮层" },
];

const COMPONENT_RULE_LABELS = {
  radius: "圆角",
  primaryVariant: "主变体",
  surface: "表面",
  border: "描边",
  shadow: "阴影",
  padding: "内边距",
  size: "尺寸",
};

function trimmed(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/** 对比度 → 可读性等级 */
export function contrastGrade(foreground, background) {
  const ratio = contrastRatio(foreground, background);
  if (ratio >= 7) return { ratio, level: "AAA", tone: "pass" };
  if (ratio >= 4.5) return { ratio, level: "AA", tone: "pass" };
  if (ratio >= 3) return { ratio, level: "AA Large", tone: "warn" };
  return { ratio, level: "对比不足", tone: "fail" };
}

/**
 * 色板分组。只输出 DESIGN.md 里实际存在且是合法 hex 的颜色；
 * 分组内一个都不剩时整组丢弃。额外把 schema 之外的自定义颜色收进「其他」组。
 */
export function groupDesignColors(meta = {}) {
  const colors = meta.colors && typeof meta.colors === "object" ? meta.colors : {};
  const known = new Set(COLOR_GROUPS.flatMap((group) => group.tokens));
  const background = hexToRgb(colors.background) ? colors.background : "#ffffff";

  const buildItem = (token) => {
    const value = colors[token];
    if (!hexToRgb(value)) return null;
    const isSurfaceToken = token === "background" || token === "surface";
    // 表面色看的是「文字放上去可读吗」，其余色看的是「它放在页面底色上可读吗」
    const grade = isSurfaceToken
      ? contrastGrade(colors.text || "#18181b", value)
      : contrastGrade(value, background);
    return {
      token,
      value: value.trim(),
      usage: COLOR_USAGE[token] || "自定义角色",
      onColor: readableOn(value),
      contrast: grade,
      contrastAgainst: isSurfaceToken ? "文字色" : "页面底色",
    };
  };

  const groups = COLOR_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    items: group.tokens.map(buildItem).filter(Boolean),
  })).filter((group) => group.items.length > 0);

  const extras = Object.keys(colors)
    .filter((token) => !known.has(token))
    .map(buildItem)
    .filter(Boolean);

  if (extras.length) {
    groups.push({
      id: "extra",
      title: "扩展色",
      description: "DESIGN.md 自定义的额外颜色角色。",
      items: extras,
    });
  }
  return groups;
}

/** 字阶，按字号从大到小；无 scale 时返回空数组 */
export function designTypeScale(meta = {}) {
  const scale = meta.typography?.scale;
  if (!scale || typeof scale !== "object") return [];
  return TYPE_TOKENS
    .map((entry) => {
      const size = trimmed(scale[entry.token]);
      return size ? { ...entry, size } : null;
    })
    .filter(Boolean)
    .sort((a, b) => Number.parseFloat(b.size) - Number.parseFloat(a.size));
}

/** 间距刻度；每档附上「几倍 unit」的说明 */
export function designSpacingScale(meta = {}) {
  const spacing = meta.spacing;
  if (!spacing || typeof spacing !== "object") return null;
  const unit = trimmed(spacing.unit);
  const unitValue = Number.parseFloat(unit);
  const values = Array.isArray(spacing.scale) ? spacing.scale : [];
  const steps = values
    .map((value) => trimmed(value))
    .filter(Boolean)
    .map((value) => {
      const parsed = Number.parseFloat(value);
      const multiple = unitValue > 0 && Number.isFinite(parsed) ? parsed / unitValue : null;
      return {
        value,
        px: Number.isFinite(parsed) ? parsed : 0,
        multiple: multiple !== null ? Number(multiple.toFixed(2)) : null,
      };
    });
  if (!unit && !steps.length) return null;
  const max = steps.reduce((largest, step) => Math.max(largest, step.px), 0);
  return {
    unit,
    steps: steps.map((step) => ({
      ...step,
      ratio: max > 0 ? step.px / max : 0,
    })),
  };
}

export function designRadiusScale(meta = {}) {
  const radius = meta.radius;
  if (!radius || typeof radius !== "object") return [];
  return RADIUS_TOKENS
    .map((entry) => {
      const value = trimmed(radius[entry.token]);
      return value ? { ...entry, value } : null;
    })
    .filter(Boolean);
}

export function designShadowScale(meta = {}) {
  const shadows = meta.shadows;
  if (!shadows || typeof shadows !== "object") return [];
  return SHADOW_TOKENS
    .map((entry) => {
      const value = trimmed(shadows[entry.token]);
      return value ? { ...entry, value } : null;
    })
    .filter(Boolean);
}

export function designMotion(meta = {}) {
  const motion = meta.motion;
  if (!motion || typeof motion !== "object") return null;
  const duration = trimmed(motion.duration);
  const easing = trimmed(motion.easing);
  if (!duration && !easing) return null;
  return { duration, easing };
}

/** components 对象摊平成可渲染的规则行 */
export function designComponentRules(meta = {}) {
  const components = meta.components;
  if (!components || typeof components !== "object") return [];
  return Object.entries(components)
    .filter(([, rules]) => rules && typeof rules === "object")
    .map(([component, rules]) => ({
      component,
      rules: Object.entries(rules).map(([rule, value]) => ({
        rule,
        label: COMPONENT_RULE_LABELS[rule] || rule,
        value: String(value),
      })),
    }))
    .filter((entry) => entry.rules.length > 0);
}

export function designAntiPatterns(meta = {}) {
  return Array.isArray(meta.antiPatterns)
    ? meta.antiPatterns.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

/**
 * DESIGN.md 正文的轻量解析。只支持生成器实际产出的三种语法：
 * `# 标题`（丢弃，标题已在别处展示）、`## 小节`、`- 列表项`，其余按段落收进当前小节。
 */
export function stripFrontMatter(content) {
  if (typeof content !== "string") return "";
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length) : content;
}

export function parseDesignBody(body) {
  if (typeof body !== "string" || !body.trim()) return [];
  const sections = [];
  let current = null;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      current = { title: line.slice(3).trim(), items: [], paragraphs: [] };
      sections.push(current);
      continue;
    }
    if (line.startsWith("# ")) {
      current = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("- ") || line.startsWith("* ")) {
      current.items.push(line.slice(2).trim());
    } else {
      current.paragraphs.push(line);
    }
  }
  return sections.filter((section) => section.items.length || section.paragraphs.length);
}

/** 概览条用的摘要 */
export function designSummary(meta = {}) {
  const colorCount = Object.values(meta.colors || {}).filter((value) => hexToRgb(value)).length;
  return {
    fontFamily: trimmed(meta.typography?.fontFamily) || "未声明字体",
    primary: hexToRgb(meta.colors?.primary) ? meta.colors.primary.trim() : null,
    colorCount,
    typeCount: designTypeScale(meta).length,
    spacingCount: designSpacingScale(meta)?.steps.length || 0,
    radiusCount: designRadiusScale(meta).length,
    shadowCount: designShadowScale(meta).length,
  };
}
