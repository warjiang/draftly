/**
 * detect.js — 已有项目检测（SPEC 2.4，Phase 4 / Week10）。
 *
 * detectProject(dir)：
 *  - framework：package.json dependencies/devDependencies → react / vue / next / unknown
 *  - styling：tailwind.config.* 存在 → 'tailwind'；deps 含 @mui/* → 'mui'；
 *            src/*.css 的 :root 块含 CSS 变量 → 'css-vars'；否则 'unknown'
 *  - componentsDir：src/components → components → app/components 中首个存在的目录
 *  - tailwindConfig：简易正则解析 tailwind.config 的 theme.extend.colors（嵌套 map 拍平）
 *  - cssVars：src 下所有 css 文件的 :root { --name: value } 变量表
 *  - components：componentsDir 下扫描到的组件文件（相对项目根，仅 .jsx/.tsx/.vue/.svelte/.js/.ts）
 *
 * generateDesignMdFromDetection(detection)：生成过 validateDesignMd 的 DESIGN.md 全文，
 * 优先使用检测到的色值（tailwind colors 或 CSS 变量），字体取自 CSS 变量/默认栈。
 */
import fs from 'node:fs';
import path from 'node:path';
import { defaultDesignMd } from '../../shared/src/design-md.js';

const TAILWIND_CONFIG_RE = /^tailwind\.config\.(js|cjs|mjs|ts)$/;
const COMPONENT_EXT_RE = /\.(jsx|tsx|vue|svelte|js|ts)$/;

/** 读取 package.json（不存在/损坏 → null） */
function readPkg(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** 合并 dependencies + devDependencies 的包名集合 */
function depNames(pkg) {
  const names = new Set();
  for (const key of ['dependencies', 'devDependencies']) {
    const deps = pkg?.[key];
    if (deps && typeof deps === 'object') for (const n of Object.keys(deps)) names.add(n);
  }
  return names;
}

/** 递归收集目录下匹配扩展名的文件（相对 root，排序保证确定性），跳过 node_modules/隐藏目录 */
function walkFiles(root, sub, extsRe, maxDepth = 6) {
  const base = path.join(root, sub);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (extsRe.test(e.name)) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(base, 0);
  return out.sort();
}

/** 简易正则提取 tailwind.config 的 theme.extend.colors → 拍平 { name | name-shade: hex } */
export function parseTailwindColors(configSource) {
  const colors = {};
  const extendIdx = configSource.search(/extend\s*:\s*\{/);
  if (extendIdx < 0) return colors;
  const colorsM = /colors\s*:\s*\{/.exec(configSource.slice(extendIdx));
  if (!colorsM) return colors;
  const openIdx = extendIdx + colorsM.index + colorsM[0].length - 1; // '{' 下标
  const closeIdx = matchBrace(configSource, openIdx);
  if (closeIdx < 0) return colors;
  const body = configSource.slice(openIdx + 1, closeIdx);
  // 逐顶层 key 解析：key: '#hex' 或 key: { 500: '#hex', ... }
  for (const part of splitTop(body)) {
    const m = /^\s*['"]?([\w-]+)['"]?\s*:\s*([\s\S]*)$/.exec(part);
    if (!m) continue;
    const [, key, rawVal] = m;
    const val = rawVal.trim().replace(/,$/, '');
    const hex = /^['"](#[0-9a-fA-F]{3,8})['"]$/.exec(val);
    if (hex) { colors[key] = hex[1]; continue; }
    if (val.startsWith('{')) {
      const innerRe = /['"]?([\w-]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]/g;
      let im;
      while ((im = innerRe.exec(val))) colors[`${key}-${im[1]}`] = im[2];
    }
  }
  return colors;
}

function matchBrace(s, openIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote && s[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 按顶层逗号切分（跳过嵌套 {} 与引号） */
function splitTop(src) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(src.slice(start, i)); start = i + 1; }
  }
  parts.push(src.slice(start));
  return parts;
}

/** 从 CSS 文本提取 :root 块的 --var: value 变量表 */
export function extractCssVars(cssSource) {
  const vars = {};
  const rootRe = /:root\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = rootRe.exec(cssSource))) {
    const declRe = /--([\w-]+)\s*:\s*([^;]+);/g;
    let d;
    while ((d = declRe.exec(m[1]))) vars[d[1]] = d[2].trim();
  }
  return vars;
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * @param {string} dir 项目根目录
 * @returns {{ framework: 'react'|'vue'|'next'|'unknown',
 *             styling: 'tailwind'|'css-vars'|'mui'|'unknown',
 *             componentsDir: string|null, tailwindConfig: object|null,
 *             cssVars: object, components: string[] }}
 */
export function detectProject(dir) {
  const pkg = readPkg(dir);
  const deps = depNames(pkg);

  let framework = 'unknown';
  if (deps.has('next')) framework = 'next';
  else if (deps.has('react')) framework = 'react';
  else if (deps.has('vue')) framework = 'vue';

  // tailwind.config.*
  let tailwindConfig = null;
  let hasTailwindConfig = false;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (TAILWIND_CONFIG_RE.test(f)) {
        hasTailwindConfig = true;
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        tailwindConfig = { file: f, colors: parseTailwindColors(src) };
        break;
      }
    }
  } catch { /* unreadable dir */ }

  // src/**/*.css → CSS 变量
  const cssFiles = walkFiles(dir, 'src', /\.css$/);
  const cssVars = {};
  for (const rel of cssFiles) {
    try {
      Object.assign(cssVars, extractCssVars(fs.readFileSync(path.join(dir, rel), 'utf8')));
    } catch { /* ignore */ }
  }

  let styling = 'unknown';
  if (hasTailwindConfig) styling = 'tailwind';
  else if (deps.has('@mui/material') || [...deps].some((d) => d.startsWith('@mui/'))) styling = 'mui';
  else if (Object.keys(cssVars).length > 0) styling = 'css-vars';

  let componentsDir = null;
  for (const cand of ['src/components', 'components', 'app/components']) {
    try {
      if (fs.statSync(path.join(dir, cand)).isDirectory()) { componentsDir = cand; break; }
    } catch { /* not exists */ }
  }
  const components = componentsDir ? walkFiles(dir, componentsDir, COMPONENT_EXT_RE) : [];

  return { framework, styling, componentsDir, tailwindConfig, cssVars, components };
}

/** 检测到的颜色池中按候选键名挑一个合法 hex */
function pickColor(pool, keys) {
  for (const k of keys) {
    const v = pool[k];
    if (typeof v === 'string' && HEX_RE.test(v)) return v;
  }
  return null;
}

/**
 * 由检测结果生成 DESIGN.md 全文（过 validateDesignMd）。
 * 色值优先级：tailwindConfig.colors → cssVars（hex 值）→ 默认值。
 */
export function generateDesignMdFromDetection(detection) {
  const tw = detection.tailwindConfig?.colors || {};
  const cssHex = {};
  for (const [k, v] of Object.entries(detection.cssVars || {})) {
    if (HEX_RE.test(v)) cssHex[k] = v;
  }
  const colors = {
    primary: pickColor(tw, ['primary', 'primary-500', 'brand', 'blue-500', 'indigo-500'])
      ?? pickColor(cssHex, ['primary', 'color-primary', 'accent', 'brand']),
    background: pickColor(tw, ['background', 'base', 'gray-50']) ?? pickColor(cssHex, ['background', 'bg']),
    surface: pickColor(tw, ['surface', 'card', 'white']) ?? pickColor(cssHex, ['surface', 'card-bg']),
    text: pickColor(tw, ['text', 'foreground', 'gray-900']) ?? pickColor(cssHex, ['text', 'foreground']),
    muted: pickColor(tw, ['muted', 'gray-500']) ?? pickColor(cssHex, ['muted', 'text-muted', 'muted-foreground']),
    border: pickColor(tw, ['border', 'gray-200']) ?? pickColor(cssHex, ['border', 'border-color']),
    accent: pickColor(tw, ['accent', 'secondary', 'accent-500']) ?? pickColor(cssHex, ['accent', 'secondary']),
    destructive: pickColor(tw, ['destructive', 'danger', 'red-500']) ?? pickColor(cssHex, ['danger', 'destructive']),
  };
  const overrides = {
    name: `detected-${detection.framework}-${detection.styling}`,
    colors: Object.fromEntries(Object.entries(colors).filter(([, v]) => v)),
  };
  // 字体：CSS 变量 --font-family / --font-sans
  const font = detection.cssVars?.['font-family'] || detection.cssVars?.['font-sans'];
  if (font) overrides.typography = { fontFamily: font };
  return defaultDesignMd(overrides);
}

/**
 * 由检测结果生成 component-registry.json 对象（过 validateRegistry）。
 * 扫描到的组件文件 → { name: 文件名去扩展 PascalCase，import: "@/..." }。
 */
export function generateRegistryFromDetection(detection) {
  const components = [];
  const seen = new Set();
  for (const rel of detection.components || []) {
    const base = path.posix.basename(rel).replace(COMPONENT_EXT_RE, '');
    if (!/^[A-Z]/.test(base)) continue; // 仅大写开头的组件文件
    if (seen.has(base)) continue;
    seen.add(base);
    const importPath = '@/' + rel.replace(/^src\//, '').replace(COMPONENT_EXT_RE, '');
    components.push({ name: base, import: importPath, variants: [], props: {} });
  }
  return { components };
}
