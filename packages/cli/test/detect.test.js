import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectProject, generateDesignMdFromDetection, generateRegistryFromDetection, parseTailwindColors, extractCssVars } from '../src/detect.js';
import { validateDesignMd } from '../../shared/src/design-md.js';
import { validateRegistry } from '../../shared/src/registry.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'react-tailwind-app');

test('detectProject: fixture 检测 framework=react / styling=tailwind', () => {
  const d = detectProject(FIXTURE);
  assert.equal(d.framework, 'react');
  assert.equal(d.styling, 'tailwind');
  assert.equal(d.componentsDir, 'src/components');
  assert.deepEqual(d.components, ['src/components/Button.jsx']);
});

test('parseTailwindColors: theme.extend.colors 拍平（含嵌套）', () => {
  const src = fs.readFileSync(path.join(FIXTURE, 'tailwind.config.js'), 'utf8');
  const colors = parseTailwindColors(src);
  assert.equal(colors.primary, '#3b6ea5');
  assert.equal(colors.muted, '#8a8a85');
  assert.equal(colors['accent-500'], '#d97706');
});

test('extractCssVars: :root CSS 变量提取', () => {
  const d = detectProject(FIXTURE);
  assert.equal(d.cssVars.background, '#f8f8f6');
  assert.equal(d.cssVars['font-family'], '"Inter", "PingFang SC", sans-serif');
});

test('generateDesignMdFromDetection: 检测色值进入 DESIGN.md 且过 validateDesignMd', () => {
  const d = detectProject(FIXTURE);
  const md = generateDesignMdFromDetection(d);
  assert.deepEqual(validateDesignMd(md), []);
  assert.match(md, /#3b6ea5/); // tailwind primary
  assert.match(md, /Inter/); // CSS 变量字体
});

test('generateRegistryFromDetection: 组件扫描 → 合法 registry', () => {
  const d = detectProject(FIXTURE);
  const reg = generateRegistryFromDetection(d);
  assert.deepEqual(validateRegistry(reg), []);
  assert.equal(reg.components.length, 1);
  assert.equal(reg.components[0].name, 'Button');
  assert.equal(reg.components[0].import, '@/components/Button');
});

test('detectProject: 未知项目 → unknown', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-detect-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', dependencies: { lodash: '1' } }));
  const d = detectProject(tmp);
  assert.equal(d.framework, 'unknown');
  assert.equal(d.styling, 'unknown');
  assert.equal(d.componentsDir, null);
});

test('detectProject: vue + css-vars 项目', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-detect-'));
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { vue: '^3' } }));
  fs.writeFileSync(path.join(tmp, 'src', 'main.css'), ':root { --primary: #112233; }\n');
  const d = detectProject(tmp);
  assert.equal(d.framework, 'vue');
  assert.equal(d.styling, 'css-vars');
});

test('detectProject: next + mui 项目', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-detect-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { next: '14', '@mui/material': '5', react: '18' } }));
  const d = detectProject(tmp);
  assert.equal(d.framework, 'next');
  assert.equal(d.styling, 'mui');
});

test('generateDesignMdFromDetection: 空检测也过校验（回退默认色值）', () => {
  const md = generateDesignMdFromDetection({ framework: 'unknown', styling: 'unknown', cssVars: {}, tailwindConfig: null, components: [] });
  assert.deepEqual(validateDesignMd(md), []);
});
