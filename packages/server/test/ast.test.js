/**
 * ast.test.js — Phase 2 Task 2.2：AST 精准修改强化（行扫描内核，接口同 SPEC 2.2）。
 * 覆盖：className 三形态、style 合并、text 保护、格式保留（diff 行数断言）、边界 case。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  injectSourceLoc, findElementByLoc, matchBracket,
  patchElementClass, patchElementText, patchElementStyle,
} from '../src/ast.js';

/** 断言行级 diff：只有 expectedChangedLines（1-based）这些行发生变化，其余逐字节相同 */
function assertOnlyLinesChanged(before, after, expectedChangedLines) {
  const a = before.split('\n');
  const b = after.split('\n');
  assert.equal(a.length, b.length, '行数不应变化');
  const changed = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed.push(i + 1);
  assert.deepEqual(changed, expectedChangedLines, `预期只改 ${expectedChangedLines}，实际改了 ${changed}`);
}

/* ---------- 共用 fixture：每个开标签独占一行 ---------- */
const PAGE = `import { cn } from './utils';
import { Button } from '@/components/ui/button';

export default function App() {
  const active = true;
  return (
    <div className="page">
      <h1 className="title">标题</h1>
      <p className={cn("base", active && "on")}>正文</p>
      <span className={clsx("a", "b")}>标签</span>
      <em>无类名</em>
      <div style={{ minHeight: '100vh', display: 'flex' }}>
        <Button variant="default">按钮</Button>
        <Button variant="ghost">按钮2</Button>
      </div>
      <section>
        <p>{dynamicText}</p>
      </section>
    </div>
  );
}
`;

const LOCATED = injectSourceLoc(PAGE, 'App.jsx');
/** 取包含 needle 的第 occurrence 行上的 data-source-loc */
const locOf = (needle, occurrence = 0) => {
  const hits = LOCATED.split('\n').filter((l) => l.includes(needle));
  if (!hits[occurrence]) throw new Error(`loc not found for ${needle}#${occurrence}`);
  return /data-source-loc="([^"]+)"/.exec(hits[occurrence])[1];
};

test('格式保留基线：injectSourceLoc 后 findElementByLoc 可定位', () => {
  const loc = locOf('<h1');
  const el = findElementByLoc(LOCATED, loc);
  assert.equal(el.tag, 'h1');
});

/* ---------- 形态①：字符串字面量 ---------- */
test('class 形态①：className="..." 整体替换，其余行逐字节相同', () => {
  const loc = locOf('<h1');
  const out = patchElementClass(LOCATED, loc, 'title text-4xl font-bold');
  assert.match(out, /className="title text-4xl font-bold"/);
  assertOnlyLinesChanged(LOCATED, out, [Number(loc.split(':')[1])]);
});

/* ---------- 形态②：cn(...) ---------- */
test('class 形态②：cn("a", cond && "b") 追加缺失 token，条件参数不动', () => {
  const loc = locOf('cn("base"');
  const out = patchElementClass(LOCATED, loc, 'base text-lg');
  assert.match(out, /className=\{cn\("base", active && "on", "text-lg"\)\}/);
  assertOnlyLinesChanged(LOCATED, out, [Number(loc.split(':')[1])]);
});

test('class 形态②：token 全部已存在 → 无变化（幂等）', () => {
  const loc = locOf('cn("base"');
  const out = patchElementClass(LOCATED, loc, 'base on');
  assert.equal(out, LOCATED);
});

/* ---------- 形态③：clsx(...) ---------- */
test('class 形态③：clsx(...) 追加 token', () => {
  const loc = locOf('<span');
  const out = patchElementClass(LOCATED, loc, 'a c');
  assert.match(out, /className=\{clsx\("a", "b", "c"\)\}/);
  assertOnlyLinesChanged(LOCATED, out, [Number(loc.split(':')[1])]);
});

/* ---------- 无 className → 新建 ---------- */
test('class：无 className 属性时新建一个', () => {
  const loc = locOf('<em');
  const out = patchElementClass(LOCATED, loc, 'emphasis');
  assert.match(out, /<em className="emphasis" data-source-loc/);
  assertOnlyLinesChanged(LOCATED, out, [Number(loc.split(':')[1])]);
});

test('class：非 cn/clsx 表达式显式报错', () => {
  const code = `export default function App() {\n  return (\n    <div className={styles.box}>x</div>\n  );\n}\n`;
  const withLoc = injectSourceLoc(code, 'A.jsx');
  const loc = /data-source-loc="([^"]+)"/.exec(withLoc)[1];
  assert.throws(() => patchElementClass(withLoc, loc, 'x'), /non-cn\/clsx expression/);
});

/* ---------- style 合并 ---------- */
test('style：已有 style={{...}} 同名字段覆盖、其余保留、新字段追加', () => {
  const loc = locOf('style={{ minHeight');
  const out = patchElementStyle(LOCATED, loc, { display: 'grid', gap: '16px' });
  assert.match(out, /style=\{\{ minHeight: '100vh', "display": "grid", "gap": "16px" \}\}/);
  assertOnlyLinesChanged(LOCATED, out, [Number(loc.split(':')[1])]);
});

test('style：无 style 属性时新建', () => {
  const loc = locOf('<h1');
  const out = patchElementStyle(LOCATED, loc, { color: '#b4544a' });
  assert.match(out, /<h1 style=\{\{ "color": "#b4544a" \}\} data-source-loc/);
  assertOnlyLinesChanged(LOCATED, out, [Number(loc.split(':')[1])]);
});

test('style：style={expr} 非对象字面量显式报错', () => {
  const code = `export default function App() {\n  return (\n    <div style={theme.box}>x</div>\n  );\n}\n`;
  const withLoc = injectSourceLoc(code, 'A.jsx');
  const loc = /data-source-loc="([^"]+)"/.exec(withLoc)[1];
  assert.throws(() => patchElementStyle(withLoc, loc, { color: 'red' }), /non-object expression/);
});

/* ---------- text ---------- */
test('text：纯文本替换保留缩进与兄弟节点', () => {
  const loc = locOf('<em');
  const out = patchElementText(LOCATED, loc, '斜体改文案');
  assert.match(out, />斜体改文案<\/em>/);
  assertOnlyLinesChanged(LOCATED, out, [Number(loc.split(':')[1])]);
});

test('text：含表达式/子元素显式报错（Phase 1 保护保留）', () => {
  const exprP = locOf('<p', 1); // <p>{dynamicText}</p>
  assert.throws(() => patchElementText(LOCATED, exprP, 'x'), /non-text children/);
  const section = locOf('<section'); // 含子元素
  assert.throws(() => patchElementText(LOCATED, section, 'x'), /non-text children/);
});

/* ---------- 边界：多属性换行 + 嵌套同 loc 不串扰 ---------- */
test('边界：多行开标签（属性换行）可 patch', () => {
  const code = `export default function App() {
  return (
    <div
      className="multi"
      id="root-box"
    >
      <span>inner</span>
    </div>
  );
}
`;
  const withLoc = injectSourceLoc(code, 'A.jsx');
  const loc = /data-source-loc="([^"]+)"/.exec(withLoc)[1];
  const out = patchElementClass(withLoc, loc, 'multi enlarged');
  assert.match(out, /className="multi enlarged"/);
  // 仅 className 行变化
  const changed = withLoc.split('\n').map((l, i) => (l !== out.split('\n')[i] ? i + 1 : null)).filter(Boolean);
  assert.deepEqual(changed, [4]);
});

test('边界：嵌套同名元素各自 loc 互不串扰', () => {
  const outer = locOf('className="page"');       // .page
  const innerDiv = locOf('style={{ minHeight');        // style div
  const btn1 = locOf('<Button', 0);
  const btn2 = locOf('<Button', 1);
  const out1 = patchElementClass(LOCATED, btn1, 'btn-a');
  const out2 = patchElementClass(out1, btn2, 'btn-b');
  assert.match(out2, /<Button className="btn-a" data-source-loc[^>]*variant="default"/);
  assert.match(out2, /<Button className="btn-b" data-source-loc[^>]*variant="ghost"/);
  // 外层 div 不受影响
  assert.match(out2, /className="page"/);
  assert.notEqual(outer, innerDiv);
});

test('matchBracket：跳过字符串与嵌套', () => {
  const s = 'cn("a(", x && "b", f(")"))';
  const open = s.indexOf('(');
  const close = matchBracket(s, open, '(', ')');
  assert.equal(close, s.length - 1);
});
