/**
 * templates.js — 模板库（Phase 3 Task 3.3）
 *
 * 数据：packages/server/data/templates/*.json
 * schema：
 * {
 *   id: 'stripe',                 // 小写字母/数字/连字符，与文件名一致
 *   name: 'Stripe',
 *   sourceUrl: 'https://stripe.com',
 *   tags: { style: ['极简'], industry: ['金融'], color: ['紫'] },
 *   confidence: 'curated',        // 人工策展（后续可为 extracted-high / extracted-low）
 *   screenshot: null,             // 截图占位（离线环境用色板预览替代）
 *   designMd: '<DESIGN.md 全文>'  // 必须通过 validateDesignMd
 * }
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDesignMd, parseDesignMd } from '../../shared/src/design-md.js';

const TEMPLATES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/templates');
const TAG_KEYS = ['style', 'industry', 'color'];

/** @returns {string[]} 错误列表，空 = 通过 */
export function validateTemplate(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return ['template must be object'];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(t.id || '')) errors.push(`invalid id: ${t.id}`);
  if (!t.name || typeof t.name !== 'string') errors.push('name required');
  if (t.sourceUrl && !/^https?:\/\//.test(t.sourceUrl)) errors.push(`invalid sourceUrl: ${t.sourceUrl}`);
  if (!t.tags || typeof t.tags !== 'object') {
    errors.push('tags required ({ style, industry, color })');
  } else {
    for (const k of TAG_KEYS) {
      if (!Array.isArray(t.tags[k])) errors.push(`tags.${k} must be array`);
    }
  }
  if (typeof t.confidence !== 'string' || !t.confidence) errors.push('confidence required');
  if (typeof t.designMd !== 'string' || !t.designMd.trim()) {
    errors.push('designMd required');
  } else {
    for (const e of validateDesignMd(t.designMd)) errors.push(`designMd: ${e}`);
  }
  return errors;
}

/**
 * 加载全部模板（文件名序 = 确定性顺序）。
 * 任一模板非法 → 抛错（数据即代码，宁可 fail-fast）。
 * @returns {Promise<Array<object>} Promise<object>[]>}
 */
export async function loadTemplates(dir = TEMPLATES_DIR) {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const templates = [];
  for (const f of files) {
    const t = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
    const errors = validateTemplate(t);
    if (errors.length) throw new Error(`invalid template ${f}: ${errors.join('; ')}`);
    templates.push(t);
  }
  const ids = new Set();
  for (const t of templates) {
    if (ids.has(t.id)) throw new Error(`duplicated template id: ${t.id}`);
    ids.add(t.id);
  }
  return templates;
}

/** 列表摘要（不含 designMd 全文；附色板供编辑器预览） */
export function templateSummary(t) {
  const { meta } = parseDesignMd(t.designMd);
  return {
    id: t.id, name: t.name, sourceUrl: t.sourceUrl, tags: t.tags,
    confidence: t.confidence, screenshot: t.screenshot ?? null,
    colors: meta.colors || {},
  };
}

export async function getTemplate(id, dir = TEMPLATES_DIR) {
  const all = await loadTemplates(dir);
  return all.find((t) => t.id === id) || null;
}
