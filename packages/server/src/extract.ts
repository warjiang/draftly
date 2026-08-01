/**
 * extract.js — 网站设计系统提取（SPEC 2.2 / Phase 3 Task 3.2）
 *
 * 核心算法为纯函数 extractDesign({ html, cssTexts })：
 * 输入抓取到的 html 字符串 + css 文本数组（离线可测，不依赖浏览器/网络）。
 * 输出 { designMd, tokens, tailwindCss }：
 *   - designMd   : DESIGN.md 全文（复用 @draftly/shared defaultDesignMd 覆盖）
 *   - tokens     : 固定 schema 的 JSON（见下）
 *   - tailwindCss: :root CSS 变量 + @theme 注释
 *
 * tokens schema（固定）：
 * {
 *   colors:    [{ hex, share, role }],           // share ∈ [0,1] 按出现频率加权，role: primary|background|surface|text|neutral
 *   typography:{ fontFamily, scale: { h1..h6?, body, small? } },
 *   spacing:   { unit: '8px', values: ['4px', ...] },
 *   radius:    { mode: '8px', values: [...] },
 *   shadows:   { mode: '0 1px 2px ...', values: [...] },
 * }
 *
 * 算法全部为确定性实现：K-means 固定初始化（按频率排序等距取中心）+ 固定迭代次数，
 * 同输入永远同输出。
 */
import { defaultDesignMd, parseDesignMd } from '../../shared/src/design-md.js';
import { errorWithStatus } from './types.js';

type Rgb = [number, number, number];
type ColorRole = 'primary' | 'background' | 'surface' | 'text' | 'neutral';
type ColorCluster = {
  hex: string;
  share: number;
  role?: ColorRole;
};
type AssignedColorCluster = ColorCluster & { role: ColorRole };
type Typography = {
  fontFamily: string;
  scale: Record<string, string>;
};
type ExtractedTokens = {
  colors: AssignedColorCluster[];
  typography: Typography;
  spacing: { unit: string; values: string[] };
  radius: { mode: string; values: string[] };
  shadows: { mode: string; values: string[] };
};
type ExtractedDesign = {
  designMd: string;
  tokens: ExtractedTokens;
  tailwindCss: string;
};

/* ================= 颜色：归一化 + 聚类 ================= */

const NAMED_COLORS: Record<string, string | null> = {
  black: '#000000', white: '#ffffff', transparent: null, red: '#ff0000',
  green: '#008000', blue: '#0000ff', gray: '#808080', grey: '#808080',
  orange: '#ffa500', yellow: '#ffff00', purple: '#800080', pink: '#ffc0cb',
};

/** hex/rgb(a)/hsl(a)/常见命名色 → '#rrggbb'；无法解析 → null */
export function normalizeColor(raw: unknown): string | null {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  if (NAMED_COLORS[s] !== undefined) return NAMED_COLORS[s];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    return '#' + h;
  }
  m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/.exec(s);
  if (m) {
    const to = (v: string) =>
      Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0');
    return '#' + to(m[1]) + to(m[2]) + to(m[3]);
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%/.exec(s);
  if (m) return hslToHex(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
  return null;
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m0 = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + m0) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

/** 从 css 文本提取全部颜色（含频次，排除渐变外的 currentColor 等无效值） */
export function extractColors(css: string): Map<string, number> {
  const freq = new Map<string, number>();
  const re = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:black|white|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/g;
  for (const m of css.matchAll(re)) {
    const hex = normalizeColor(m[0]);
    if (hex) freq.set(hex, (freq.get(hex) || 0) + 1);
  }
  return freq; // Map<hex, count>
}

const rgbOf = (hex: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const dist2 = (a: Rgb, b: Rgb): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * 确定性 K-means（欧氏 RGB 距离）：
 * - k 自适应 4–8：k = min(8, max(4, ceil(unique/4)))，且不超过 unique 数
 * - 初始化：按频次降序排序后等距取 k 个中心（固定，无随机）
 * - 固定 25 轮迭代，频次加权质心
 * @returns {Array<{ hex: string, share: number }>} 按 share 降序
 */
export function clusterColors(
  freq: Map<string, number>,
  {
    minK = 4,
    maxK = 8,
    iterations = 25,
  }: { minK?: number; maxK?: number; iterations?: number } = {},
): ColorCluster[] {
  const entries = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (!entries.length || !total) return [];
  const unique = entries.length;
  const k = Math.max(Math.min(Math.max(minK, Math.ceil(unique / 2)), maxK, unique), 1);
  // 等距取初始中心（确定性 seed）
  let centers: Rgb[] = [];
  for (let i = 0; i < k; i++) {
    centers.push(rgbOf(entries[Math.floor((i * unique) / k)][0]));
  }
  const points = entries.map(([hex, count]) => ({ rgb: rgbOf(hex), count }));
  const assign = new Array(points.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(points[i].rgb, centers[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    const sums: Array<[number, number, number, number]> =
      centers.map(() => [0, 0, 0, 0]); // r,g,b,weight
    for (let i = 0; i < points.length; i++) {
      const s = sums[assign[i]];
      s[0] += points[i].rgb[0] * points[i].count;
      s[1] += points[i].rgb[1] * points[i].count;
      s[2] += points[i].rgb[2] * points[i].count;
      s[3] += points[i].count;
    }
    centers = sums.map((s, c): Rgb =>
      s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[c]);
    if (!moved && it > 0) break;
  }
  // 汇总簇；代表色取簇内频次最高的原始颜色（medoid），比质心更忠实于原站配色
  const clusters: Array<{
    weight: number;
    members: Array<{ hex: string; count: number }>;
  }> = centers.map(() => ({ weight: 0, members: [] }));
  for (let i = 0; i < points.length; i++) {
    const cl = clusters[assign[i]];
    cl.weight += points[i].count;
    cl.members.push({ hex: entries[i][0], count: points[i].count });
  }
  return clusters
    .filter((c) => c.weight > 0)
    .map((c) => ({
      hex: c.members.sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex))[0].hex,
      share: c.weight / total,
    }))
    .sort((a, b) => b.share - a.share || a.hex.localeCompare(b.hex));
}

/** 簇 → 语义角色：primary=饱和度最高簇；background=占比最高簇；text=与 background 距离最远簇 */
export function assignColorRoles(clusters: ColorCluster[]): AssignedColorCluster[] {
  if (!clusters.length) return [];
  const sat = (hex: string): number => {
    const [r, g, b] = rgbOf(hex);
    return Math.max(r, g, b) - Math.min(r, g, b);
  };
  const lum = (hex: string): number => {
    const [r, g, b] = rgbOf(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const primary = [...clusters].sort((a, b) => sat(b.hex) - sat(a.hex) || b.share - a.share)[0];
  // background：低饱和且明度极端（近黑/近白）的簇中 share 最高者；兜底 share 最高非 primary 簇
  const extremes = clusters
    .filter((c) => c !== primary && sat(c.hex) < 60 && (lum(c.hex) < 48 || lum(c.hex) > 207))
    .sort((a, b) => b.share - a.share || a.hex.localeCompare(b.hex));
  const background = extremes[0] || clusters.find((c) => c !== primary) || clusters[0];
  const text = [...clusters]
    .filter((c) => c !== background && sat(c.hex) < 60)
    .sort((a, b) => Math.abs(lum(b.hex) - lum(background.hex)) - Math.abs(lum(a.hex) - lum(background.hex)))[0]
    || clusters[clusters.length - 1];
  const surface = clusters.find((c) => c !== background && c !== primary && c !== text) || background;
  return clusters.map((c) => ({
    ...c,
    role: c === primary ? 'primary' : c === background ? 'background' : c === text ? 'text' : c === surface ? 'surface' : 'neutral',
  }));
}

/** 两个 hex 按 t ∈ [0,1] 混合 */
export function mixHex(a: string, b: string, t: number): string {
  const A = rgbOf(a), B = rgbOf(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/* ================= 字体层级 ================= */

/** font-size 频率 → 层级：body=频率最高；大于 body 的降序映射 h1..h6；小于 body → small */
export function extractTypography(css: string): Typography {
  const sizeFreq = new Map<string, number>();
  for (const m of css.matchAll(/font-size\s*:\s*([\d.]+)px/g)) {
    sizeFreq.set(m[1], (sizeFreq.get(m[1]) || 0) + 1);
  }
  const famFreq = new Map<string, number>();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
    const first = m[1].split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (first && !/^(inherit|initial|unset)$/i.test(first)) famFreq.set(first, (famFreq.get(first) || 0) + 1);
  }
  const fontFamily = [...famFreq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
    || '-apple-system, "Segoe UI", sans-serif';
  const scale: Record<string, string> = {};
  if (sizeFreq.size) {
    const byFreq = [...sizeFreq.entries()].sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]));
    const bodySize = Number(byFreq[0][0]);
    scale.body = `${bodySize}px`;
    const bigger = [...sizeFreq.keys()].map(Number).filter((v) => v > bodySize).sort((a, b) => b - a);
    bigger.slice(0, 6).forEach((v, i) => { scale[`h${i + 1}`] = `${v}px`; });
    const smaller = [...sizeFreq.keys()].map(Number).filter((v) => v < bodySize).sort((a, b) => a - b);
    if (smaller.length) scale.small = `${smaller[0]}px`;
  } else {
    scale.h1 = '32px'; scale.h2 = '24px'; scale.h3 = '18px'; scale.body = '14px'; scale.small = '13px';
  }
  return { fontFamily, scale };
}

/* ================= 间距基数（GCD） ================= */

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** padding/margin 数值集合 → GCD 基础间距（clamp 到 2–16，失败回退 8） */
export function extractSpacing(css: string): { unit: string; values: string[] } {
  const values = new Set<number>();
  for (const m of css.matchAll(/(?:padding|margin)(?:-[a-z]+)?\s*:\s*([^;}]+)/g)) {
    for (const n of m[1].matchAll(/([\d.]+)px/g)) {
      const v = Number(n[1]);
      if (v > 0 && v <= 200) values.add(v);
    }
  }
  const list = [...values].sort((a, b) => a - b);
  let base = 8;
  if (list.length) {
    const g = list.reduce((acc, v) => gcd(acc, Math.round(v)), 0);
    if (g >= 2 && g <= 16) base = g;
  }
  return { unit: `${base}px`, values: list.map((v) => `${v}px`) };
}

/* ================= radius / shadow 众数 ================= */

export function extractRadius(css: string): { mode: string; values: string[] } {
  const freq = new Map<string, number>();
  for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim();
    freq.set(v, (freq.get(v) || 0) + 1);
  }
  const values = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  return { mode: values[0] || '8px', values };
}

export function extractShadows(css: string): { mode: string; values: string[] } {
  const freq = new Map<string, number>();
  for (const m of css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim().replace(/\s+/g, ' ');
    if (v !== 'none') freq.set(v, (freq.get(v) || 0) + 1);
  }
  const values = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  return { mode: values[0] || '0 1px 2px rgba(0,0,0,0.06)', values };
}

/* ================= 主入口 ================= */

/**
 * @param {{ html?: string, cssTexts: string[] }} input
 * @returns {{ designMd: string, tokens: object, tailwindCss: string }}
 */
export function extractDesign({
  html = '',
  cssTexts = [],
}: {
  html?: string;
  cssTexts?: string[];
} = {}): ExtractedDesign {
  const css = [...cssTexts].join('\n');
  // html 内联 style 也并入提取语料
  const inline = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join('\n');
  const corpus = css + '\n' + inline;

  const clusters = assignColorRoles(clusterColors(extractColors(corpus)));
  const typography = extractTypography(corpus);
  const spacing = extractSpacing(corpus);
  const radius = extractRadius(corpus);
  const shadows = extractShadows(corpus);

  const byRole = (role: ColorRole): string | undefined =>
    clusters.find((cluster) => cluster.role === role)?.hex;
  const background = byRole('background') || '#ffffff';
  const primary = byRole('primary') || '#3f4a5a';
  const text = byRole('text') || '#2e2e2c';
  const surface = byRole('surface') || background;

  const tokens = {
    colors: clusters.map((c) => ({ hex: c.hex, share: Number(c.share.toFixed(4)), role: c.role })),
    typography,
    spacing,
    radius,
    shadows,
  };

  const designMd = defaultDesignMd({
    name: 'extracted-theme',
    colors: {
      background,
      surface,
      primary,
      text,
      muted: mixHex(text, background, 0.45),
      border: mixHex(text, background, 0.85),
      accent: primary,
      destructive: '#b4544a',
    },
    typography: { fontFamily: typography.fontFamily, scale: typography.scale },
    spacing: { unit: spacing.unit, scale: spacing.values.slice(0, 8) },
    radius: { sm: radius.values.find((v) => v !== radius.mode) || radius.mode, md: radius.mode, full: '999px' },
    shadows: { sm: shadows.mode, md: shadows.values[1] || shadows.mode, lg: shadows.values[2] || shadows.mode },
    antiPatterns: ['no-blue-purple-gradient', 'no-one-off-hex-colors', 'no-inline-px-outside-scale'],
  }).replace('# DESIGN.md — extracted-theme',
    `# DESIGN.md — extracted-theme\n\n> 由 /api/extract 从网站样式自动提取；主色 ${primary}，间距基数 ${spacing.unit}。`);

  const tailwindCss = [
    '/* @theme — 由设计提取生成的 Tailwind 主题变量',
    `   主色 ${primary} / 背景 ${background} / 文本 ${text} / 间距基数 ${spacing.unit} */`,
    ':root {',
    ...tokens.colors.map((c) => `  --color-${c.role}-${c.hex.slice(1)}: ${c.hex}; /* share ${(c.share * 100).toFixed(1)}% */`),
    `  --color-primary: ${primary};`,
    `  --color-background: ${background};`,
    `  --color-surface: ${surface};`,
    `  --color-text: ${text};`,
    `  --font-family-base: ${typography.fontFamily};`,
    ...Object.entries(typography.scale).map(([k, v]) => `  --font-size-${k}: ${v};`),
    `  --spacing-unit: ${spacing.unit};`,
    `  --radius-md: ${radius.mode};`,
    `  --shadow-sm: ${shadows.mode};`,
    '}',
    '',
  ].join('\n');

  return { designMd, tokens, tailwindCss };
}

/* ================= 可选增强：URL 抓取（有网络时） ================= */

/**
 * fetch 真实网页 HTML + CSS（<style> 与 link[rel=stylesheet]）。
 * 离线/失败时抛出带引导信息的错误（HTTP 层映射 501）。
 */
export async function fetchSiteAssets(
  url: string,
  { timeoutMs = 8000 }: { timeoutMs?: number } = {},
): Promise<{ html: string; cssTexts: string[] }> {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`invalid url: ${url}`); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('only http(s) url supported');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
    const html = await res.text();
    const cssTexts = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
    const links = [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi)]
      .map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1])
      .filter((href): href is string => Boolean(href));
    for (const href of links.slice(0, 8)) {
      try {
        const cssRes = await fetch(new URL(href, url).href, { signal: ctrl.signal });
        if (cssRes.ok) cssTexts.push(await cssRes.text());
      } catch { /* 单个样式表失败不阻塞 */ }
    }
    return { html, cssTexts };
  } catch (error: unknown) {
    const cause = errorWithStatus(error);
    const err = errorWithStatus(new Error(
      `无法抓取 ${url}（${cause.message}）。当前环境可能无网络：请改用 POST /api/extract { html, css } 直接粘贴页面源码。`,
    ));
    err.code = 'EXTRACT_OFFLINE';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
