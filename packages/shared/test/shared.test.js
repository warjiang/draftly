import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignMd, serializeDesignMd, defaultDesignMd, validateDesignMd } from '../src/design-md.js';
import {
  MockProvider, createProvider, LLMProvider,
  DRAFT_PROMPT_MARKER, ITERATE_PROMPT_MARKER, EDIT_ELEMENT_PROMPT_MARKER, EDIT_BY_IMAGE_PROMPT_MARKER,
} from '../src/llm.js';

test('parseDesignMd / serializeDesignMd 往返', () => {
  const src = defaultDesignMd();
  const { meta, body } = parseDesignMd(src);
  assert.equal(meta.colors.primary, '#3f4a5a');
  assert.equal(meta.typography.scale.h1, '32px');
  assert.deepEqual(meta.spacing.scale, ['4px', '8px', '16px', '24px', '40px']);
  assert.match(body, /设计原则/);
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

test('MockProvider 草稿模式：确定性整页 HTML（登录/仪表盘/落地页）', async () => {
  const p = new MockProvider();
  const mk = (s) => [{ role: 'system', content: DRAFT_PROMPT_MARKER }, { role: 'user', content: s }];
  const login1 = await p.complete(mk('做一个登录页'));
  const login2 = await p.complete(mk('帮我做个 login 页面'));
  assert.equal(login1, login2); // 确定性
  assert.match(login1, /<!doctype html>/i);
  assert.match(login1, /登录/);
  const dash = await p.complete(mk('做一个数据仪表盘'));
  assert.match(dash, /仪表盘/);
  const land = await p.complete(mk('做一个产品落地页'));
  assert.match(land, /落地|AI|免费开始/);
});

test('MockProvider 迭代模式与元素局部编辑模式', async () => {
  const p = new MockProvider();
  const iterMsgs = [
    { role: 'system', content: ITERATE_PROMPT_MARKER },
    { role: 'user', content: '当前 HTML：\n<!doctype html><html><body><h1>草稿</h1></body></html>\n\n修改指令：改成深色模式' },
  ];
  const iter = await p.complete(iterMsgs);
  assert.match(iter, /m2-iterated|dark/i);

  const editMsgs = [
    { role: 'system', content: EDIT_ELEMENT_PROMPT_MARKER },
    { role: 'user', content: '目标元素：\n<button data-did="3">b</button>\n\n修改指令：换成描边样式' },
  ];
  const edit = await p.complete(editMsgs);
  assert.match(edit, /data-did="3"/);
  assert.match(edit, /border: 2px solid/);
});

test('MockProvider 截图修改模式：注入截图标记 + 确定性（多模态消息）', async () => {
  const p = new MockProvider();
  const msgs = [
    { role: 'system', content: EDIT_BY_IMAGE_PROMPT_MARKER },
    { role: 'user', content: [
      { type: 'text', text: '当前 HTML：\n<!doctype html><html><body><h1>草稿</h1></body></html>\n\n修改指令：改成深色模式' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
    ] },
  ];
  const out = await p.complete(msgs);
  assert.match(out, /m-img-edit/);
  assert.equal(await p.complete(msgs), out); // 确定性
});

test('createProvider 无 key -> MockProvider', () => {
  delete process.env.DRAFTLY_LLM_API_KEY;
  delete process.env.DRAFTLY_LLM_BASE_URL;
  assert.ok(createProvider() instanceof MockProvider);
  assert.ok(createProvider() instanceof LLMProvider);
});
