import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncDraftToLocal, createDraftFromLocal, compareDraftLocal, mergeWithPreserve, diffLines } from '../src/sync.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-sync-')); }
function write(root, rel, content) {
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const LOCAL_APP = `export function App() {
  const [count, setCount] = useState(0);
  return (
    <div data-source-loc="src/App.jsx:4:12" className="page">
      <h1 data-source-loc="src/App.jsx:5:8" className="title">Hello</h1>
      // @draftly-preserve-start
      const api = fetch('/api/legacy');
      // @draftly-preserve-end
    </div>
  );
}
`;

const DRAFT_APP = `export function App() {
  return (
    <div data-source-loc="src/App.jsx:3:12" className="page-v2">
      <h1 data-source-loc="src/App.jsx:4:8" className="title-xl">Hello draftly</h1>
    </div>
  );
}
`;

test('overwrite：草稿整文件覆盖本地（preserve 块也被覆盖）', async () => {
  const draft = tmp();
  const local = tmp();
  write(draft, 'src/App.jsx', DRAFT_APP);
  write(local, 'src/App.jsx', LOCAL_APP);
  const report = await syncDraftToLocal({ draftDir: draft, localDir: local, strategy: 'overwrite' });
  assert.deepEqual(report.changed, ['src/App.jsx']);
  assert.equal(read(local, 'src/App.jsx'), DRAFT_APP);
  // 内容一致后再跑 → skipped
  const again = await syncDraftToLocal({ draftDir: draft, localDir: local, strategy: 'overwrite' });
  assert.deepEqual(again.skipped, ['src/App.jsx']);
});

test('merge：草稿 UI 结构为准，local preserve 块内容存活', async () => {
  const draft = tmp();
  const local = tmp();
  write(draft, 'src/App.jsx', DRAFT_APP);
  write(local, 'src/App.jsx', LOCAL_APP);
  const report = await syncDraftToLocal({ draftDir: draft, localDir: local, strategy: 'merge' });
  assert.deepEqual(report.changed, ['src/App.jsx']);
  const out = read(local, 'src/App.jsx');
  assert.match(out, /className="page-v2"/); // 草稿 UI 结构
  assert.match(out, /Hello draftly/);
  assert.match(out, /fetch\('\/api\/legacy'\)/); // preserve 块存活
  assert.match(out, /@draftly-preserve-start/);
  assert.doesNotMatch(out, /useState/); // 草稿无此行
});

test('merge：草稿含同名标记块 → 块内内容用 local 的', () => {
  const draft = `// header\n// @draftly-preserve-start\nconst api = fetch('/new');\n// @draftly-preserve-end\n`;
  const local = `// header old\n// @draftly-preserve-start\nconst api = fetch('/legacy');\nconst extra = 1;\n// @draftly-preserve-end\n`;
  const out = mergeWithPreserve(draft, local);
  assert.match(out, /\/\/ header\n/); // 草稿结构
  assert.match(out, /fetch\('\/legacy'\)/); // 块内容来自 local
  assert.match(out, /const extra = 1;/);
});

test('merge：preserve 不配对 → conflict 并回退 overwrite', async () => {
  const draft = tmp();
  const local = tmp();
  write(draft, 'a.js', 'const a = 1;\n');
  write(local, 'a.js', '// @draftly-preserve-start\nconst b = 2;\n'); // 无 end
  const report = await syncDraftToLocal({ draftDir: draft, localDir: local, strategy: 'merge' });
  assert.equal(report.conflicts.length, 1);
  assert.equal(read(local, 'a.js'), 'const a = 1;\n');
});

test('patch：仅同步 className 差异，逻辑代码不动', async () => {
  const draft = tmp();
  const local = tmp();
  const localCode = `export function App() {
  const secret = doNotTouch();
  return <div data-source-loc="src/App.jsx:3:11" className="old">Hi</div>;
}
`;
  const draftCode = `export function App() {
  return <div data-source-loc="src/App.jsx:3:11" className="new shiny">Hi</div>;
}
`;
  write(draft, 'src/App.jsx', draftCode);
  write(local, 'src/App.jsx', localCode);
  const report = await syncDraftToLocal({ draftDir: draft, localDir: local, strategy: 'patch' });
  assert.deepEqual(report.changed, ['src/App.jsx']);
  assert.deepEqual(report.conflicts, []);
  const out = read(local, 'src/App.jsx');
  assert.match(out, /className="new shiny"/); // class 已对齐
  assert.match(out, /const secret = doNotTouch\(\);/); // 逻辑未动
  // 再跑 → class 一致 → skipped
  const again = await syncDraftToLocal({ draftDir: draft, localDir: local, strategy: 'patch' });
  assert.deepEqual(again.skipped, ['src/App.jsx']);
  assert.deepEqual(again.changed, []);
});

test('patch：loc 对不上 → conflict，不动文件', async () => {
  const draft = tmp();
  const local = tmp();
  write(draft, 'src/App.jsx', '<div data-source-loc="src/App.jsx:9:9" className="x">a</div>\n');
  write(local, 'src/App.jsx', '<div data-source-loc="src/App.jsx:1:1" className="y">b</div>\n');
  const report = await syncDraftToLocal({ draftDir: draft, localDir: local, strategy: 'patch' });
  assert.equal(report.conflicts.length, 1);
  assert.deepEqual(report.changed, []);
  assert.match(read(local, 'src/App.jsx'), /className="y"/);
});

test('createDraftFromLocal：反向拷贝代码文件 + 生成 DESIGN.md', async () => {
  const local = tmp();
  const draft = path.join(tmp(), 'draft');
  write(local, 'package.json', JSON.stringify({ dependencies: { react: '18' } }));
  write(local, 'tailwind.config.js', 'export default { theme: { extend: { colors: { primary: "#123456" } } } };\n');
  write(local, 'src/App.jsx', LOCAL_APP);
  write(local, 'node_modules/x/index.js', 'skip me');
  const report = await createDraftFromLocal({ localDir: local, draftDir: draft });
  assert.ok(report.changed.includes('src/App.jsx'));
  assert.ok(report.changed.includes('DESIGN.md'));
  assert.equal(read(draft, 'src/App.jsx'), LOCAL_APP);
  assert.equal(fs.existsSync(path.join(draft, 'node_modules', 'x', 'index.js')), false);
  const md = read(draft, 'DESIGN.md');
  assert.match(md, /#123456/); // 检测色值进入 DESIGN.md
  // 本地有 DESIGN.md → 拷贝而非生成
  write(local, 'DESIGN.md', '---\nname: mine\n---\ncustom\n');
  const r2 = await createDraftFromLocal({ localDir: local, draftDir: draft });
  assert.ok(r2.changed.includes('DESIGN.md'));
  assert.match(read(draft, 'DESIGN.md'), /name: mine/);
});

test('compareDraftLocal：added / removed / modified + hunks', async () => {
  const draft = tmp();
  const local = tmp();
  write(draft, 'src/App.jsx', 'line1\nline2-draft\nline3\n');
  write(local, 'src/App.jsx', 'line1\nline2-local\nline3\n');
  write(draft, 'src/New.jsx', 'new file\n');
  write(local, 'src/Old.jsx', 'old file\n');
  write(draft, 'same.js', 'same\n');
  write(local, 'same.js', 'same\n');
  const { diffs } = await compareDraftLocal({ draftDir: draft, localDir: local });
  const byFile = Object.fromEntries(diffs.map((d) => [d.file, d]));
  assert.equal(byFile['src/App.jsx'].kind, 'modified');
  assert.deepEqual(byFile['src/App.jsx'].hunks, [{ removed: 'line2-local', added: 'line2-draft' }]);
  assert.equal(byFile['src/New.jsx'].kind, 'added');
  assert.equal(byFile['src/Old.jsx'].kind, 'removed');
  assert.equal(byFile['same.js'], undefined); // 无差异
  // 同步后：modified/added 消失（sync 不删除 local 独有文件 → removed 保留，属非破坏性语义）
  await syncDraftToLocal({ draftDir: draft, localDir: local, strategy: 'overwrite' });
  const after = await compareDraftLocal({ draftDir: draft, localDir: local });
  assert.deepEqual(after.diffs.map((d) => d.kind), ['removed']);
  assert.equal(after.diffs[0].file, 'src/Old.jsx');
});

test('diffLines：多段变更', () => {
  const hunks = diffLines('a\nb\nc\nd\n', 'a\nB\nc\nD\n');
  assert.deepEqual(hunks, [{ removed: 'b', added: 'B' }, { removed: 'd', added: 'D' }]);
});
