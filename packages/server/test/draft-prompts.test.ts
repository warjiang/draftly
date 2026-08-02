import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGenerateInstruction,
  buildImageEditInstruction,
  buildIterateInstruction,
  buildSourceEditInstruction,
} from '../src/draft-prompts.js';

test('generation prompt enforces the shared frontend quality baseline', () => {
  const prompt = buildGenerateInstruction({
    userPrompt: '做一个独立开发者产品页',
    designMd: '# design contract',
    variant: 2,
  });

  assert.match(prompt, /Tailwind CSS v4 and shadcn\/ui/);
  assert.match(prompt, /Field\/FieldGroup/);
  assert.match(prompt, /loading, empty, error/);
  assert.match(prompt, /prefers-reduced-motion/);
  assert.match(prompt, /no default three-equal-card rows/);
  assert.match(prompt, /binding visual design contract/);
  assert.match(prompt, /design variant 2/);
  assert.match(prompt, /complete primary flow/);
});

test('all edit prompts retain the stack, accessibility, and component rules', () => {
  const prompts = [
    buildIterateInstruction({ instruction: '调整布局' }),
    buildSourceEditInstruction({ instruction: '强化标题', context: '<h1>标题</h1>' }),
    buildImageEditInstruction({ instruction: '参考截图修改' }),
  ];

  for (const prompt of prompts) {
    assert.match(prompt, /shadcn components/);
    assert.match(prompt, /visible focus states/);
    assert.match(prompt, /transform and opacity only/);
    assert.match(prompt, /npm run build/);
  }
});

test('annotated multi-element prompt isolates each element and forbids collateral edits', () => {
  const prompt = buildSourceEditInstruction({
    instruction: '整体更克制',
    context: 'ignored',
    annotations: [
      { context: 'src/App.tsx:\n<h1>', comment: '标题改小' },
      { context: 'src/App.tsx:\n<button>', comment: '主色按钮' },
    ],
  });
  assert.match(prompt, /annotated 2 rendered element\(s\)/);
  assert.match(prompt, /Do not restyle, move, or otherwise modify any element that is not listed/);
  assert.match(prompt, /Element 1:/);
  assert.match(prompt, /Element 2:/);
  assert.match(prompt, /标题改小/);
});

test('annotation prompt surfaces previewed inline styles as intended result', () => {
  const prompt = buildSourceEditInstruction({
    instruction: '',
    context: 'ignored',
    annotations: [
      {
        context: 'src/App.tsx:\n<h1>',
        comment: '按整体目标调整该元素',
        styleEdits: { color: '#111', fontSize: '32px' },
      },
    ],
  });
  assert.match(prompt, /already previewed these inline styles/);
  assert.match(prompt, /color: #111/);
  assert.match(prompt, /fontSize: 32px/);
  assert.match(prompt, /prefer semantic Tailwind classes/);
});
