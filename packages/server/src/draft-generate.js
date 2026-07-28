/**
 * draft-generate.js — HTML 草稿生成管线（M1）
 * prompt → LLM（可并行多变体）→ 后处理（提取/清洗/data-did）→ 落盘版本
 */
import { buildDraftPrompt } from './draft-prompts.js';
import { postProcessHtml } from './html-post.js';

export const MAX_VARIANTS = 3;

/**
 * @param {{ drafts: import('./drafts.js').DraftStore, provider: object,
 *           prompt: string, variants?: number, designMd?: string|null }} opts
 * @returns {Promise<{ drafts: Array<{ id: string, title: string, version: number }> }>}
 */
export async function generateDrafts({ drafts, provider, prompt, variants = 1, designMd = null }) {
  const count = Math.min(Math.max(Number.parseInt(variants, 10) || 1, 1), MAX_VARIANTS);
  const messages = buildDraftPrompt({ userPrompt: prompt, designMd });
  const results = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      // 变体间拉开 temperature，获得差异化方案（MockProvider 忽略该参数，保持确定性）
      const raw = await provider.complete(messages, { temperature: 0.2 + i * 0.3 });
      const html = postProcessHtml(raw);
      const draft = await drafts.create({ prompt });
      const { meta, v } = await drafts.saveVersion(draft.id, html, { kind: 'generate' });
      return { id: draft.id, title: meta.title, version: v };
    }),
  );
  return { drafts: results };
}
