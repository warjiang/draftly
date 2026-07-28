/**
 * draft-prompts.js — HTML 草稿生成 Prompt（M1）
 * 模型角色 = 资深 UI 设计师；产物 = 单文件 HTML（内联 <style>，无外链 JS）。
 * DRAFT_PROMPT_MARKER 由 @draftly/shared 定义，MockProvider 依此返回确定性 HTML（离线可测）。
 */
import { DRAFT_PROMPT_MARKER, ITERATE_PROMPT_MARKER, EDIT_ELEMENT_PROMPT_MARKER } from '../../shared/src/llm.js';

export { DRAFT_PROMPT_MARKER };

/**
 * @param {{ userPrompt: string, designMd?: string|null }} opts
 * @returns {Array<{ role: string, content: string }>} messages
 */
export function buildDraftPrompt({ userPrompt, designMd = null }) {
  const system = [
    `你是一名资深 UI 设计师，工作在「${DRAFT_PROMPT_MARKER}」下。`,
    '根据用户需求，输出一个完整、可直接在浏览器渲染的单文件 HTML 设计草稿。',
    '',
    '硬性要求：',
    '1. 输出且仅输出 HTML：以 <!doctype html> 开头，不要 Markdown 围栏，不要任何解释文字。',
    '2. 所有样式写在 <head> 的内联 <style> 中；禁止引用任何外部 JS / CSS / 字体文件。',
    '3. 设计质量：遵循 8px 间距体系；清晰字阶（h1 32–40px / h2 24px / 正文 14–16px）；',
    '   配色有层次（背景 / 卡片表面 / 主色 / 正文 / 次要文本）；按钮与卡片带 hover 态；圆角与阴影克制。',
    '4. 布局：现代 Web 页面结构（按需包含导航 / 主视觉 / 卡片栅格 / 页脚），桌面端宽度，内容区 max-width 居中。',
    '5. 图片一律用 https://placehold.co 占位（如 https://placehold.co/600x400）或内联 SVG；禁止其他外链资源。',
    '6. 文案使用与用户需求同语种的真实感示例文案，禁止 lorem ipsum。',
  ];
  if (designMd) {
    system.push(
      '',
      '以下是项目设计契约 DESIGN.md，草稿的配色、字体、圆角、间距必须与其一致：',
      designMd,
    );
  }
  return [
    { role: 'system', content: system.join('\n') },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * @param {{ currentHtml: string, instruction: string }} opts
 * @returns {Array<{ role: string, content: string }>} messages
 */
export function buildIteratePrompt({ currentHtml, instruction }) {
  const system = [
    `你正在「${ITERATE_PROMPT_MARKER}」下工作。`,
    '用户会给出一个当前 HTML 草稿和一条修改指令。',
    '请输出修改后的完整 HTML 文档（以 <!doctype html> 开头），不要 Markdown 围栏，不要解释。',
    '保持原有结构和 data-did 属性不变，只按指令做必要改动。',
    '所有样式继续内联在 <head> 中，禁止外链 JS/CSS。',
  ];
  return [
    { role: 'system', content: system.join('\n') },
    { role: 'user', content: `当前 HTML：\n${currentHtml}\n\n修改指令：${instruction}` },
  ];
}

/**
 * @param {{ elementHtml: string, instruction: string }} opts
 * @returns {Array<{ role: string, content: string }>} messages
 */
export function buildEditElementPrompt({ elementHtml, instruction }) {
  const system = [
    `你正在「${EDIT_ELEMENT_PROMPT_MARKER}」下工作。`,
    '用户会给出一个 HTML 元素（含 data-did 定位属性）和一条修改指令。',
    '只输出修改后的该元素完整 HTML（outerHTML），不要 Markdown 围栏，不要任何解释文字。',
    '',
    '硬性要求：',
    '1. 必须保留根元素的 data-did 属性及其原值，禁止改动。',
    '2. 样式改动优先使用内联 style；文案用同语种真实感示例。',
    '3. 只修改该元素及其子节点，不要输出元素之外的任何内容。',
  ];
  return [
    { role: 'system', content: system.join('\n') },
    { role: 'user', content: `目标元素：\n${elementHtml}\n\n修改指令：${instruction}` },
  ];
}
