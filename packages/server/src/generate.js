/**
 * generate.js — AI 页面生成管线（SPEC 2.2）
 * buildGenerationPrompt：注入组件索引 + DESIGN.md 约束
 * generatePage：LLM 生成 → 提取代码 → 注入 data-source-loc → 写入 sandbox src/App.jsx
 */
// 注：/mnt 挂载不支持 symlink，npm workspaces 无法链接 @draftly/shared，
// 故用相对路径导入（降级决策，见 progress/TASK-1.2.md）。
import { loadBuiltinRegistry, componentIndex } from '../../shared/src/registry.js';
import { defaultDesignMd, parseDesignMd } from '../../shared/src/design-md.js';
import { injectSourceLoc } from './ast.js';

const APP_FILE = 'src/App.jsx';

/**
 * @returns {Array<{role:'system'|'user', content:string}>} messages
 */
export function buildGenerationPrompt({ userPrompt, registry, designMd } = {}) {
  const reg = registry || loadBuiltinRegistry();
  const dmd = designMd || defaultDesignMd();
  const { meta } = parseDesignMd(dmd);
  const system = [
    '你是一个资深前端工程师，负责生成单文件 React 页面（src/App.jsx）。',
    '',
    '## 可用组件（component-registry，优先使用，禁止手写重复样式）',
    componentIndex(reg),
    '',
    '## 设计约束（项目当前 DESIGN.md 全文，必须严格遵守）',
    '```markdown',
    dmd.trim(),
    '```',
    '',
    '## 反模式（antiPatterns，违反即不合格）',
    ...(Array.isArray(meta.antiPatterns) && meta.antiPatterns.length
      ? meta.antiPatterns.map((a) => `- ${a}`)
      : ['- no-blue-purple-gradient']),
    `- 主色: ${meta.colors?.primary}; 背景: ${meta.colors?.background}; 文本: ${meta.colors?.text}`,
    '- 全局约束：浅色、低饱和、留白充分；禁止使用蓝紫渐变。',
    '',
    '## 输出要求',
    '- 只输出一个 JSX 代码块：import 语句 + `export default function App()`。',
    '- 不要使用事件回调、外部数据请求或第三方库；内联样式用 style 对象。',
    '- 不要输出解释文字。',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `请生成页面：${userPrompt}` },
  ];
}

/** 从 LLM 输出中提取代码（剥离 ``` 围栏与前后杂谈） */
export function extractCode(llmOutput) {
  const fence = /```(?:jsx?|tsx?|javascript)?\s*\n([\s\S]*?)```/.exec(llmOutput);
  let code = fence ? fence[1] : llmOutput;
  // 保留 design-tokens 注释（MockProvider 的 DESIGN.md 主色确定性映射标记）
  const tokenMark = /^\/\* design-tokens: [^*]*\*\/\n/.exec(code)?.[0] || '';
  // 截取第一个 import/export 起
  const start = code.search(/^(import|export)/m);
  if (start > 0) code = code.slice(start);
  return tokenMark + code.trim() + '\n';
}

/**
 * 生成页面并写入 sandbox。
 * @param {{ sandbox: import('./sandbox.js').ProjectSandbox, provider: import('@draftly/shared/llm.js').LLMProvider, userPrompt: string }} opts
 * @returns {Promise<{ file: string, code: string }>}
 */
export async function generatePage({ sandbox, provider, userPrompt }) {
  if (!sandbox) throw new Error('generatePage: sandbox required');
  if (!provider) throw new Error('generatePage: provider required');
  if (!userPrompt) throw new Error('generatePage: userPrompt required');

  // sandbox 初始化：DESIGN.md 不存在则自动写入默认主题（Phase 3 Task 3.1）
  let designMd = null;
  try { designMd = await sandbox.readFile('DESIGN.md'); } catch { /* 不存在 */ }
  if (!designMd) {
    designMd = defaultDesignMd();
    await sandbox.writeFile('DESIGN.md', designMd);
  }
  const messages = buildGenerationPrompt({ userPrompt, designMd: designMd || undefined });
  const raw = await provider.complete(messages);
  let code = extractCode(raw);
  if (!/export\s+default\s+function\s+App/.test(code)) {
    throw new Error('generated code must contain `export default function App`');
  }
  // 注入 data-source-loc（幂等：已带 loc 的输出不会重复注入）
  code = injectSourceLoc(code, APP_FILE);
  await sandbox.writeFile(APP_FILE, code);
  // 读回校验写入成功
  const check = await sandbox.readFile(APP_FILE);
  if (check !== code) throw new Error('sandbox write verification failed');
  return { file: APP_FILE, code };
}
