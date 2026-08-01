import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeColor, extractColors, clusterColors, assignColorRoles,
  extractTypography, extractSpacing, extractRadius, extractShadows, extractDesign,
} from '../src/extract.js';
import { parseDesignMd, validateDesignMd } from '../../shared/src/design-md.js';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const css = await fs.readFile(path.join(FIX, 'linear-ish.css'), 'utf8');
const html = await fs.readFile(path.join(FIX, 'linear-ish.html'), 'utf8');

const near = (hex: string | null, target: string, tol = 40): boolean => {
  if (!hex) return false;
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const t = [1, 3, 5].map((i) => parseInt(target.slice(i, i + 2), 16));
  return v.every((c, i) => Math.abs(c - t[i]) <= tol);
};

test('normalizeColor：hex/rgb/rgba/hsl/命名色归一化', () => {
  assert.equal(normalizeColor('#5e6ad2'), '#5e6ad2');
  assert.equal(normalizeColor('#ABC'), '#aabbcc');
  assert.equal(normalizeColor('#5e6ad2ff'), '#5e6ad2');
  assert.equal(normalizeColor('rgb(94, 106, 210)'), '#5e6ad2');
  assert.equal(normalizeColor('rgba(94,106,210,0.5)'), '#5e6ad2');
  assert.ok(
    near(normalizeColor('hsl(232, 56%, 59%)'), '#5e6ad2', 4),
    normalizeColor('hsl(232, 56%, 59%)') ?? '',
  );
  assert.equal(normalizeColor('white'), '#ffffff');
  assert.equal(normalizeColor('transparent'), null);
  assert.equal(normalizeColor('currentColor'), null);
});

test('clusterColors：确定性 + k 自适应 + share 归一', () => {
  const freq = extractColors(css);
  const c1 = clusterColors(freq);
  const c2 = clusterColors(freq);
  assert.deepEqual(c1, c2);                       // 确定性
  assert.ok(c1.length >= 4 && c1.length <= 8);    // k ∈ [4,8]
  const sum = c1.reduce((s, c) => s + c.share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);            // 占比归一
});

test('extractTypography：body=频率最高，层级降序，主字体 Inter', () => {
  const t = extractTypography(css);
  assert.equal(t.fontFamily, 'Inter');
  assert.equal(t.scale.body, '15px');             // font-size:15px 出现最多
  assert.equal(t.scale.h1, '56px');
  assert.equal(t.scale.h2, '32px');
  const sizes = ['h1', 'h2', 'h3'].map((k) => parseInt(t.scale[k]));
  assert.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2] && sizes[2] > 15); // 有序
  assert.equal(t.scale.small, '12px');
});

test('extractSpacing：GCD 推断基数 ∈ {4,8}', () => {
  const s = extractSpacing(css);
  assert.ok(['4px', '8px'].includes(s.unit));
  assert.ok(s.values.includes('16px'));
});

test('extractRadius / extractShadows：众数统计', () => {
  assert.equal(extractRadius(css).mode, '8px');   // border-radius:8px 最频繁
  assert.equal(extractShadows(css).mode, '0 1px 2px rgba(0, 0, 0, 0.4)');
});

test('extractDesign(fixture)：designMd 主色≈#5e6ad2，tokens/tailwindCss 结构合法', () => {
  const { designMd, tokens, tailwindCss } = extractDesign({ html, cssTexts: [css] });
  // designMd 通过规范校验（Task 3.1 validateDesignMd）
  assert.deepEqual(validateDesignMd(designMd), []);
  const { meta } = parseDesignMd(designMd);
  assert.ok(
    near(meta.colors?.primary ?? null, '#5e6ad2'),
    `primary=${meta.colors?.primary}`,
  );
  assert.ok(
    near(meta.colors?.background ?? null, '#0f1011'),
    `background=${meta.colors?.background}`,
  );
  // tokens schema 固定
  assert.ok(Array.isArray(tokens.colors) && tokens.colors.length >= 4);
  for (const c of tokens.colors) {
    assert.match(c.hex, /^#[0-9a-f]{6}$/);
    assert.ok(c.share > 0 && c.share <= 1);
    assert.ok(['primary', 'background', 'surface', 'text', 'neutral'].includes(c.role));
  }
  assert.equal(tokens.colors.filter((c) => c.role === 'primary').length, 1);
  const primaryToken = tokens.colors.find((c) => c.role === 'primary');
  assert.ok(primaryToken);
  assert.ok(near(primaryToken.hex, '#5e6ad2'), `primary cluster=${primaryToken.hex}`);
  assert.ok(['4px', '8px'].includes(tokens.spacing.unit));
  // tailwindCss：:root 变量 + @theme 注释
  assert.match(tailwindCss, /@theme/);
  assert.match(tailwindCss, /:root \{/);
  assert.match(tailwindCss, /--color-primary: #[0-9a-f]{6};/);
  assert.match(tailwindCss, /--spacing-unit: \d+px;/);
  // 确定性
  assert.deepEqual(extractDesign({ html, cssTexts: [css] }), { designMd, tokens, tailwindCss });
});

test('extractDesign 空输入 → 回退默认，不抛错', () => {
  const { designMd, tokens } = extractDesign({ cssTexts: [] });
  assert.deepEqual(validateDesignMd(designMd), []);
  assert.ok(Array.isArray(tokens.colors));
});
