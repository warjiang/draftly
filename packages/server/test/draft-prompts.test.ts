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
