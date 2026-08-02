import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseDesignMd } from '../../shared/src/design-md.js';
import { DraftStore } from '../src/drafts.js';
import { createApiApp } from '../src/http.js';
import { createTestAuth } from './test-auth.js';
import { loadTemplates, validateTemplate, templateSummary } from '../src/templates.js';

test('模板库加载 10 个且全部通过 schema 校验', async () => {
  const all = await loadTemplates();
  assert.equal(all.length, 10);
  const ids = all.map((t) => t.id);
  for (const expected of ['linear', 'stripe', 'notion', 'vercel', 'airbnb', 'apple', 'github', 'figma', 'shopify', 'tailwind']) {
    assert.ok(ids.includes(expected), `missing template: ${expected}`);
  }
  for (const t of all) {
    assert.deepEqual(validateTemplate(t), []);
    assert.equal(t.confidence, 'curated'); // 人工策展标注
    const { meta } = parseDesignMd(t.designMd);
    assert.match(meta.colors?.primary ?? '', /^#[0-9a-f]{6}$/);
  }
});

test('validateTemplate 反例', () => {
  const base = { id: 'x', name: 'X', sourceUrl: 'https://x.com', tags: { style: [], industry: [], color: [] }, confidence: 'curated', designMd: '' };
  assert.ok(validateTemplate(null).length > 0);
  assert.ok(validateTemplate({ ...base, id: 'Bad ID' }).some((e) => e.includes('id')));
  assert.ok(validateTemplate({ ...base, designMd: '' }).some((e) => e.includes('designMd')));
  assert.ok(validateTemplate({ ...base, tags: { style: 'x' } }).some((e) => e.includes('tags')));
  assert.ok(validateTemplate({ ...base, designMd: 'no frontmatter' }).some((e) => e.includes('front matter')));
});

test('templateSummary 含色板预览数据', async () => {
  const stripe = (await loadTemplates()).find((t) => t.id === 'stripe');
  assert.ok(stripe);
  const s = templateSummary(stripe);
  assert.equal(s.colors.primary, '#635bff');
  assert.ok(!('designMd' in s)); // 列表不带全文
  assert.deepEqual(s.tags.color, ['紫', '蓝']);
});

/* ---------- HTTP 集成：模板列表 + 详情（M4 风格预设数据源） ---------- */

let tmp: string;
let app: ReturnType<typeof createApiApp>['app'];
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-tpl-'));
  const drafts = new DraftStore({ rootDir: path.join(tmp, 'drafts') });
  ({ app } = createApiApp({
    auth: createTestAuth(),
    provider: { runTask: async () => 'unused' },
    drafts,
    previewManager: {
      ensure: async () => ({ url: 'http://127.0.0.1/', token: 'test', status: 'ready' }),
      shutdown: async () => {},
    },
  }));
});
after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});
type ApiData = {
  templates?: Array<{ id: string; colors: Record<string, string> }>;
  designMd?: string;
  meta?: { name?: string };
};
const api = async (
  requestPath: string,
  method?: string,
  body?: unknown,
): Promise<{ status: number; data: ApiData | null }> => {
  const res = await app.request(requestPath, method ? {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  } : undefined);
  return {
    status: res.status,
    data: await res.json().catch(() => null) as ApiData | null,
  };
};

test('GET /api/templates 列表 + GET /api/templates/:id 详情', async () => {
  const list = await api('/api/templates');
  assert.equal(list.status, 200);
  assert.equal(list.data?.templates?.length, 10);
  assert.equal(
    list.data?.templates?.find((template) => template.id === 'linear')?.colors.primary,
    '#5e6ad2',
  );
  const detail = await api('/api/templates/stripe');
  assert.equal(detail.status, 200);
  assert.match(detail.data?.designMd ?? '', /#635bff/);
  assert.equal(detail.data?.meta?.name, 'stripe-theme');
  const missing = await api('/api/templates/nope');
  assert.equal(missing.status, 404);
});
