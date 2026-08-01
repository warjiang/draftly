import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignMd, serializeDesignMd, defaultDesignMd, validateDesignMd } from '../src/design-md.js';

test('parseDesignMd / serializeDesignMd 往返', () => {
  const src = defaultDesignMd();
  const { meta, body } = parseDesignMd(src);
  assert.equal(meta.colors.primary, '#347b69');
  assert.equal(meta.typography.scale.h1, '56px');
  assert.deepEqual(meta.spacing.scale, ['4px', '8px', '16px', '24px', '40px', '64px', '96px']);
  assert.match(body, /设计原则/);
  assert.match(body, /shadcn\/ui/);
  assert.match(body, /prefers-reduced-motion/);
  const round = parseDesignMd(serializeDesignMd(meta, body));
  assert.deepEqual(round.meta, meta);
  assert.equal(round.body, body);
});

test('defaultDesignMd overrides 深合并', () => {
  const src = defaultDesignMd({ colors: { primary: '#111111' }, name: 'custom' });
  const { meta } = parseDesignMd(src);
  assert.equal(meta.colors.primary, '#111111');
  assert.equal(meta.colors.surface, '#ffffff'); // 未覆盖项保留
  assert.equal(meta.name, 'custom');
});

test('validateDesignMd 正例：默认与含全字段的 DESIGN.md 通过', () => {
  assert.deepEqual(validateDesignMd(defaultDesignMd()), []);
  const full = defaultDesignMd({
    name: 'linear-ish',
    colors: { primary: '#5e6ad2', background: '#0f1011', surface: '#161718', text: '#e8e8e6', muted: '#8a8f98', border: '#23252a', accent: '#5e6ad2', destructive: '#eb5757' },
    typography: { fontFamily: 'Inter, sans-serif', scale: { h1: '40px', h2: '28px', h3: '20px', body: '15px', small: '13px' } },
    spacing: { unit: '8px', scale: ['4px', '8px', '16px', '24px', '32px'] },
    radius: { sm: '4px', md: '8px', full: '999px' },
    shadows: { sm: '0 1px 2px rgba(0,0,0,0.4)' },
    motion: { duration: '120ms', easing: 'ease-out' },
    components: { Button: { radius: 'md' } },
    antiPatterns: ['no-gradient'],
  });
  const { meta } = parseDesignMd(full);
  assert.equal(meta.shadows.sm, '0 1px 2px rgba(0,0,0,0.4)');
  assert.deepEqual(meta.antiPatterns, ['no-gradient']);
  assert.deepEqual(validateDesignMd(full), []);
});

test('validateDesignMd 反例：缺字段 / hex 非法 / 无 frontmatter', () => {
  assert.ok(validateDesignMd('').some((e) => e.includes('为空')));
  assert.ok(validateDesignMd('# 只有 markdown').some((e) => e.includes('front matter')));
  // 非法 hex
  const badHex = defaultDesignMd({ colors: { primary: 'red' } });
  assert.ok(validateDesignMd(badHex).some((e) => e.includes('colors.primary') && e.includes('hex')));
  // 3 位 hex 合法
  assert.deepEqual(validateDesignMd(defaultDesignMd({ colors: { primary: '#abc' } })), []);
  // 缺 name
  const noName = defaultDesignMd({ name: '' });
  assert.ok(validateDesignMd(noName).some((e) => e.includes('meta.name')));
  // 缺 colors 段
  const noColors = '---\nname: x\ntypography:\n  fontFamily: sans\n  scale:\n    body: 14px\nspacing:\n  unit: 8px\nradius:\n  md: 8px\n---\n\nbody\n';
  assert.ok(validateDesignMd(noColors).some((e) => e.includes('colors')));
  // spacing.unit 非 px
  assert.ok(validateDesignMd(defaultDesignMd({ spacing: { unit: '1rem' } })).some((e) => e.includes('spacing.unit')));
});

test('parseDesignMd 无 frontmatter 容错', () => {
  const { meta, body } = parseDesignMd('# hello\n正文');
  assert.deepEqual(meta, {});
  assert.match(body, /hello/);
});
