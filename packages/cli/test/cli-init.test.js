import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDesignMd } from '../../shared/src/design-md.js';
import { validateRegistry } from '../../shared/src/registry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'index.js');
const FIXTURE = path.join(HERE, 'fixtures', 'react-tailwind-app');

function copyDir(src, dst) {
  fs.cpSync(src, dst, { recursive: true });
}

test('CLI: draftly init 端到端 — tmp 目录跑 init 后文件落盘且合法', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-init-'));
  copyDir(FIXTURE, tmp);
  const out = execFileSync(process.execPath, [CLI, 'init', '--dir', tmp], { encoding: 'utf8' });
  assert.match(out, /framework:\s+react/);
  assert.match(out, /styling:\s+tailwind/);
  assert.match(out, /已写入/);

  const md = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
  assert.deepEqual(validateDesignMd(md), []);
  assert.match(md, /#3b6ea5/);
  const reg = JSON.parse(fs.readFileSync(path.join(tmp, 'component-registry.json'), 'utf8'));
  assert.deepEqual(validateRegistry(reg), []);
  assert.equal(reg.components[0].name, 'Button');
});

test('CLI: draftly init --dry-run 只打印不落盘', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-init-dry-'));
  copyDir(FIXTURE, tmp);
  const out = execFileSync(process.execPath, [CLI, 'init', '--dir', tmp, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /dry-run/);
  assert.equal(fs.existsSync(path.join(tmp, 'DESIGN.md')), false);
});

test('CLI: draftly --help 与 draftly init --help', () => {
  const out = execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.match(out, /init/);
  assert.match(out, /bridge/);
  assert.match(out, /sync/);
  const out2 = execFileSync(process.execPath, [CLI, 'init', '--help'], { encoding: 'utf8' });
  assert.match(out2, /--dry-run/);
});
