/**
 * nl-edit.js — 自然语言改元素（Phase 2 Task 2.3，SPEC 2.2 扩展）。
 * buildEditPrompt({ elementCode, designMd, instruction }) → messages
 * editElement({ sandbox, provider, loc, instruction, history? })：
 *   定位元素 → LLM/Mock 输出 {class?, text?, style?} → ast patch → 写文件 → history 快照。
 */
import { parseDesignMd } from '../../shared/src/design-md.js';
import { EDIT_PROMPT_MARKER } from '../../shared/src/llm.js';
import {
  parseLoc, findOpeningTag, matchBracket,
  patchElementClass, patchElementText, patchElementStyle,
} from './ast.js';

const APP_FILE = 'src/App.jsx';

/**
 * @returns {Array<{role:'system'|'user', content:string}>}
 */
export function buildEditPrompt({ elementCode, designMd, instruction } = {}) {
  if (!elementCode) throw new Error('buildEditPrompt: elementCode required');
  if (!instruction) throw new Error('buildEditPrompt: instruction required');
  let designSummary = '（无 DESIGN.md，使用常规 Tailwind 约定）';
  if (designMd) {
    try {
      const { meta } = parseDesignMd(designMd);
      designSummary = [
        `- 主色: ${meta.colors?.primary}; 文本: ${meta.colors?.text}; 背景: ${meta.colors?.background}`,
        `- 字体: ${meta.typography?.fontFamily}; 圆角: ${meta.radius?.md}`,
      ].join('\n');
    } catch { designSummary = designMd.slice(0, 400); }
  }
  const system = [
    `你是${EDIT_PROMPT_MARKER}（element-edit）的前端助手，根据用户指令修改给定 JSX 元素的样式/文案。`,
    '',
    '## 输出要求（严格遵守）',
    '- 只输出一个 json 代码块：{"class": "新的 class 字符串"}',
    '- 可选字段："text"（替换元素纯文本）、"style"（内联样式对象，会与现有 style 合并，同名字段覆盖）',
    '- class 使用 Tailwind 工具类；不要改动元素结构；不要输出任何解释文字。',
    '',
    '## 设计约束（DESIGN.md 摘要）',
    designSummary,
    '',
    '## 目标元素代码',
    elementCode,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: instruction },
  ];
}

/**
 * 解析 LLM 编辑输出：
 *  - ```json {...} ``` 围栏或裸 JSON → { class?, text?, style? }
 *  - 非 JSON 输出（裸 class 字符串）→ { class: <trimmed> }
 * @returns {{ class?: string, text?: string, style?: object }}
 */
export function parseEditOutput(raw) {
  const s = String(raw || '').trim();
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(s);
  const candidate = fence ? fence[1].trim() : s;
  const braceIdx = candidate.indexOf('{');
  if (braceIdx >= 0) {
    const close = matchBracket(candidate, braceIdx, '{', '}');
    if (close > 0) {
      try {
        const obj = JSON.parse(candidate.slice(braceIdx, close + 1));
        const out = {};
        if (typeof obj.class === 'string' && obj.class.trim()) out.class = obj.class.trim();
        if (typeof obj.text === 'string') out.text = obj.text;
        if (obj.style && typeof obj.style === 'object' && !Array.isArray(obj.style)) out.style = obj.style;
        return out;
      } catch { /* fallthrough：按裸 class 处理 */ }
    }
  }
  const bare = candidate.replace(/^['"]|['"]$/g, '').trim();
  return bare ? { class: bare } : {};
}

/** 提取 loc 指向元素的代码片段（开标签起 ~5 行，供 prompt 上下文） */
export function extractElementCode(code, loc, maxLines = 5) {
  const pos = findOpeningTag(code, loc);
  if (!pos) throw new Error(`element not found at ${loc}`);
  const lines = code.slice(pos.start).split('\n');
  return lines.slice(0, maxLines).join('\n');
}

/**
 * 端到端：自然语言指令 → 元素修改 → 写文件 → history 快照。
 * @param {{ sandbox: object, provider: object, loc: string, instruction: string, history?: object }} opts
 * @returns {Promise<{ file: string, content: string, edit: object, applied: string[] }>}
 */
export async function editElement({ sandbox, provider, loc, instruction, history } = {}) {
  if (!sandbox) throw new Error('editElement: sandbox required');
  if (!provider) throw new Error('editElement: provider required');
  if (!loc) throw new Error('editElement: loc required');
  if (!instruction || !String(instruction).trim()) throw new Error('editElement: instruction required');

  const file = parseLoc(loc).file || APP_FILE;
  const code = await sandbox.readFile(file);
  const elementCode = extractElementCode(code, loc);
  let designMd = null;
  try { designMd = await sandbox.readFile('DESIGN.md'); } catch { /* 可选 */ }

  const messages = buildEditPrompt({ elementCode, designMd, instruction });
  const raw = await provider.complete(messages);
  const edit = parseEditOutput(raw);
  const applied = [];

  const next = applyEdit(code, loc, edit, applied);
  if (next === code) return { file, content: code, edit, applied, unchanged: true };

  if (history) {
    const after = await history.mutate(file, () => next); // mutate 内部自带写前快照
    return { file, content: after, edit, applied };
  }
  await sandbox.writeFile(file, next);
  return { file, content: next, edit, applied };
}

/** 按 {class,text,style} 顺序应用 ast patch（纯函数，便于测试） */
export function applyEdit(code, loc, edit, applied = []) {
  let out = code;
  if (edit.class) { out = patchElementClass(out, loc, edit.class); applied.push('class'); }
  if (edit.text !== undefined) { out = patchElementText(out, loc, edit.text); applied.push('text'); }
  if (edit.style) { out = patchElementStyle(out, loc, edit.style); applied.push('style'); }
  return out;
}
