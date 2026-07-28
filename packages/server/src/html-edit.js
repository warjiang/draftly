/**
 * html-edit.js — 按 data-did 定位/替换 HTML 元素（M3）
 * 零依赖标签扫描器：处理嵌套同名标签、自闭合与 void 元素。
 * 与 html-post.js 一致，标签属性内的 ">" 不做引号感知（草稿 HTML 由 prompt 约束 + 后处理产出，可接受）。
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

const OPEN_TAG_RE = /<([a-zA-Z][\w-]*)(\s[^>]*)?>/g;

function readDid(attrs) {
  const m = /\bdata-did\s*=\s*["']([^"']*)["']/.exec(attrs || '');
  return m ? m[1] : null;
}

/**
 * 查找 data-did 对应元素的范围。
 * @returns {{ start: number, end: number, tag: string } | null}
 */
export function findElementRange(html, did) {
  const want = String(did);
  const re = new RegExp(OPEN_TAG_RE.source, 'g');
  let m;
  while ((m = re.exec(html))) {
    if (readDid(m[2]) !== want) continue;
    const tag = m[1];
    const tagLower = tag.toLowerCase();
    const openEnd = m.index + m[0].length;
    if (m[0].endsWith('/>') || VOID_TAGS.has(tagLower)) {
      return { start: m.index, end: openEnd, tag };
    }
    // 向后扫描同名开/闭标签，depth 归零即元素结束（处理同名嵌套）
    const sameTag = new RegExp(`<\\/${tag}\\s*>|<${tag}(\\s[^>]*)?\\/?>`, 'gi');
    sameTag.lastIndex = openEnd;
    let depth = 1;
    let t;
    while ((t = sameTag.exec(html))) {
      if (t[0][1] === '/') {
        depth -= 1;
      } else if (!t[0].endsWith('/>') && !VOID_TAGS.has(tagLower)) {
        depth += 1;
      }
      if (depth === 0) return { start: m.index, end: t.index + t[0].length, tag };
    }
    return null; // 未闭合，容错视为找不到
  }
  return null;
}

/** 提取元素 outerHTML；找不到返回 null */
export function extractElementHtml(html, did) {
  const r = findElementRange(html, did);
  return r ? html.slice(r.start, r.end) : null;
}

/** 用 newOuterHtml 替换 data-did 元素；找不到返回 null */
export function replaceElementHtml(html, did, newOuterHtml) {
  const r = findElementRange(html, did);
  if (!r) return null;
  return html.slice(0, r.start) + newOuterHtml + html.slice(r.end);
}

/** 文档中最大的数值型 data-did（无则 0），用于给替换片段内新元素分配不冲突的 did */
export function maxDataDid(html) {
  let max = 0;
  const re = /\bdata-did\s*=\s*["'](\d+)["']/g;
  let m;
  while ((m = re.exec(html))) max = Math.max(max, Number(m[1]));
  return max;
}

/** 确保替换片段根元素保留 data-did（LLM 丢弃时补回；已有则不动） */
export function ensureRootDid(fragment, did) {
  const m = new RegExp(OPEN_TAG_RE.source).exec(fragment);
  if (!m) return fragment;
  if (/\bdata-did\s*=/.test(m[0])) return fragment;
  const injected = /\/\s*>$/.test(m[0])
    ? m[0].replace(/\/\s*>$/, ` data-did="${did}"/>`)
    : m[0].replace(/>$/, ` data-did="${did}">`);
  return fragment.slice(0, m.index) + injected + fragment.slice(m.index + m[0].length);
}

/**
 * 从 LLM 输出提取元素片段：容忍 ```html 围栏与前后杂谈。
 * 与 extractHtml（整页文档）不同，这里取第一个 "<" 到最后一个 ">"。
 */
export function extractElementFragment(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('LLM 返回为空');
  const fence = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(text);
  const candidate = (fence ? fence[1] : text).trim();
  const start = candidate.indexOf('<');
  const end = candidate.lastIndexOf('>');
  if (start === -1 || end <= start) throw new Error('LLM 输出中未找到元素 HTML');
  return candidate.slice(start, end + 1);
}
