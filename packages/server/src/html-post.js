/**
 * html-post.js — LLM HTML 输出后处理（M1）
 * extractHtml   从模型输出中提取完整 HTML 文档（容忍围栏/前后杂谈）
 * sanitizeHtml  去 <script>、on* 事件属性、javascript: 链接（预览注入安全底线）
 * injectDataIds 给 body 内元素注入 data-did（后续 inspect/局部修改定位用）
 * postProcessHtml = extract → sanitize → injectDataIds
 */

/** 从 LLM 输出提取 HTML：优先 ```html 围栏，其次查找 <!doctype/<html 起点；截断 </html> 之后的杂谈 */
export function extractHtml(output) {
  const text = String(output || '').trim();
  if (!text) throw new Error('LLM 返回为空');
  const fence = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(text);
  const candidate = (fence ? fence[1] : text).trim();
  const start = candidate.search(/<!doctype\s+html|<html[\s>]/i);
  if (start === -1) {
    throw new Error('LLM 输出中未找到 HTML 文档（缺少 <!doctype html> 或 <html>）');
  }
  let html = candidate.slice(start);
  const end = /<\/html\s*>/i.exec(html);
  if (end) html = html.slice(0, end.index + end[0].length);
  return html;
}

/** 移除脚本与内联事件，防止草稿携带可执行 JS */
export function sanitizeHtml(html) {
  let out = String(html);
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<script\b[^>]*\/?\s*>/gi, '');
  out = out.replace(/\s(?:href|src)\s*=\s*(["'])\s*javascript:[^"']*\1/gi, '');
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  return out;
}

/** 不注入 data-did 的标签（文档骨架/样式/void 元素） */
const SKIP_TAGS = new Set([
  'html', 'head', 'body', 'meta', 'title', 'style', 'link', 'base',
  'br', 'hr', 'img', 'input', 'wbr', 'source', 'track', 'area', 'col', 'embed',
]);

/** 给 <body> 内所有可见元素注入自增 data-did；幂等（已有 data-did 的元素不重复注入） */
export function injectDataIds(html) {
  const bodyStart = /<body[\s>]/i.exec(html);
  if (!bodyStart) return html;
  const headEnd = bodyStart.index + bodyStart[0].length;
  const head = html.slice(0, headEnd);
  const body = html.slice(headEnd);
  let did = 0;
  const tagged = body.replace(/<([a-zA-Z][\w-]*)((?:(?!>)[\s\S])*?)(\/?)>/g,
    (match, tag, attrs, selfClose) => {
      if (SKIP_TAGS.has(tag.toLowerCase()) || /\bdata-did\s*=/.test(attrs)) return match;
      did += 1;
      return `<${tag}${attrs} data-did="${did}"${selfClose}>`;
    });
  return head + tagged;
}

/** 完整后处理管线：模型原始输出 → 可预览 HTML */
export function postProcessHtml(raw) {
  return injectDataIds(sanitizeHtml(extractHtml(raw)));
}
