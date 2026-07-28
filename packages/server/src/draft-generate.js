/**
 * draft-generate.js — HTML 草稿生成管线（M1）
 * prompt → LLM（可并行多变体）→ 后处理（提取/清洗/data-did）→ 落盘版本
 */
import { buildDraftPrompt, buildIteratePrompt, buildEditElementPrompt } from './draft-prompts.js';
import { postProcessHtml, sanitizeHtml, injectFragmentDataIds } from './html-post.js';
import {
  extractElementHtml, replaceElementHtml, maxDataDid, ensureRootDid, extractElementFragment,
} from './html-edit.js';

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

/**
 * @param {{ drafts: import('./drafts.js').DraftStore, provider: object,
 *           id: string, instruction: string }} opts
 * @returns {Promise<{ id: string, title: string, version: number }>}
 */
export async function iterateDraft({ drafts, provider, id, instruction }) {
  if (!instruction?.trim()) throw new Error('instruction required');
  const { html } = await drafts.readHtml(id);
  const messages = buildIteratePrompt({ currentHtml: html, instruction });
  const raw = await provider.complete(messages);
  const newHtml = postProcessHtml(raw);
  const { meta, v } = await drafts.saveVersion(id, newHtml, { kind: 'iterate', instruction });
  return { id: meta.id, title: meta.title, version: v };
}

/**
 * 点选元素局部修改（M3）：提取元素 → LLM 只输出替换元素 → 按 data-did 定位替换 → 存 v(N+1)
 * @param {{ drafts: import('./drafts.js').DraftStore, provider: object,
 *           id: string, did: string|number, instruction: string }} opts
 * @returns {Promise<{ id: string, title: string, version: number, did: string }>}
 */
export async function editDraftElement({ drafts, provider, id, did, instruction }) {
  if (!instruction?.trim()) throw new Error('instruction required');
  const { html } = await drafts.readHtml(id);
  const elementHtml = extractElementHtml(html, did);
  if (!elementHtml) {
    const e = new Error(`element not found: data-did=${did}`);
    e.status = 404;
    throw e;
  }
  const messages = buildEditElementPrompt({ elementHtml, instruction });
  const raw = await provider.complete(messages);
  // 片段后处理：提取（围栏/杂谈容错）→ 去脚本 → 根元素补回 data-did → 片段内新元素分配不冲突 did
  let fragment = sanitizeHtml(extractElementFragment(raw));
  fragment = ensureRootDid(fragment, did);
  fragment = injectFragmentDataIds(fragment, maxDataDid(html));
  const next = replaceElementHtml(html, did, fragment);
  if (next === null) {
    const e = new Error(`element not found: data-did=${did}`);
    e.status = 404;
    throw e;
  }
  const { meta, v } = await drafts.saveVersion(id, next, { kind: 'edit-element', instruction });
  return { id: meta.id, title: meta.title, version: v, did: String(did) };
}
