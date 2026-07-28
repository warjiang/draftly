import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');
const run = (args, cwd) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd });

const APP = `export function App() {
  return <div className="page">Hi</div>;
  // @draftly-preserve-start
  const api = fetch('/api/legacy');
  // @draftly-preserve-end
}
`;

test('CLI: draftly sync 端到端（from-local → 改草稿 → to-local merge → compare 干净）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-cli-sync-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '18' } }));
  fs.writeFileSync(path.join(root, 'src', 'App.jsx'), APP);

  // from-local：建立草稿
  let out = run(['sync', '--from-local'], root);
  assert.match(out, /changed:/);
  const draftApp = path.join(root, '.draftly', 'draft', 'src', 'App.jsx');
  assert.equal(fs.readFileSync(draftApp, 'utf8'), APP);
  assert.ok(fs.existsSync(path.join(root, '.draftly', 'draft', 'DESIGN.md')));

  // 修改草稿（UI 变化）
  fs.writeFileSync(draftApp, APP.replace('className="page"', 'className="page-v2"'));

  // to-local --strategy merge
  out = run(['sync', '--to-local', '--strategy', 'merge'], root);
  assert.match(out, /src\/App\.jsx/);
  const merged = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  assert.match(merged, /className="page-v2"/);
  assert.match(merged, /fetch\('\/api\/legacy'\)/); // preserve 存活

  // compare 干净
  out = run(['sync', '--compare'], root);
  assert.match(out, /无差异/);
});

test('CLI: draftly sync 参数校验（缺方向/坏 strategy 非零退出）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-cli-sync-'));
  assert.throws(() => run(['sync'], root));
  assert.throws(() => run(['sync', '--to-local', '--strategy', 'bogus'], root));
});
