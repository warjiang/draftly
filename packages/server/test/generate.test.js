import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockProvider } from '../../shared/src/llm.js';
import { loadBuiltinRegistry } from '../../shared/src/registry.js';
import { defaultDesignMd } from '../../shared/src/design-md.js';
import { ProjectSandbox } from '../src/sandbox.js';
import { buildGenerationPrompt, extractCode, generatePage } from '../src/generate.js';
import { injectSourceLoc, patchElementText, patchElementClass, patchElementStyle, findElementByLoc } from '../src/ast.js';

let tmp;
before(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-gen-')); });
after(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

test('buildGenerationPrompt 注入组件索引与 DESIGN.md 约束', () => {
  const msgs = buildGenerationPrompt({
    userPrompt: '做一个登录页',
    registry: loadBuiltinRegistry(),
    designMd: defaultDesignMd(),
  });
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].role, 'user');
  assert.match(msgs[1].content, /做一个登录页/);
  assert.match(msgs[0].content, /Button \(from "@\/components\/ui\/button"\)/);
  assert.match(msgs[0].content, /Dialog/);
  assert.match(msgs[0].content, /#3f4a5a/);   // DESIGN.md 主色
  assert.match(msgs[0].content, /禁止/);
});

test('extractCode 剥离围栏与杂谈', () => {
  assert.equal(extractCode('当然！\n```jsx\nimport { A } from "x";\nexport default function App() {}\n```\n希望有用'), 'import { A } from "x";\nexport default function App() {}\n');
  assert.equal(extractCode('export default function App() {}\n'), 'export default function App() {}\n');
});

test('injectSourceLoc 注入且幂等', () => {
  const code = `import { Button } from '@/components/ui/button';\nexport default function App() {\n  return (\n    <div className="a">\n      <Button>Hi</Button>\n    </div>\n  );\n}\n`;
  const out = injectSourceLoc(code, 'src/App.jsx');
  assert.match(out, /<div data-source-loc="src\/App\.jsx:4:6" className="a">/);
  assert.match(out, /<Button data-source-loc="src\/App\.jsx:5:8">Hi<\/Button>/);
  assert.doesNotMatch(out, /import \{ Button \} data-source-loc/); // import 行不注入
  const twice = injectSourceLoc(out, 'src/App.jsx');
  assert.equal(twice, out); // 幂等
});

test('ast patch：text / class / style / findElementByLoc', () => {
  let code = `export default function App() {\n  return (\n    <div>\n      <h1 data-source-loc="src/App.jsx:4:8" style={{ margin: '0' }}>旧标题</h1>\n      <Button data-source-loc="src/App.jsx:5:8" variant="outline">按钮</Button>\n    </div>\n  );\n}\n`;
  // text
  code = patchElementText(code, 'src/App.jsx:4:8', '新标题');
  assert.match(code, />新标题<\/h1>/);
  assert.doesNotMatch(code, /旧标题/);
  // class（新增 className）
  code = patchElementClass(code, 'src/App.jsx:5:8', 'btn-primary');
  assert.match(code, /<Button className="btn-primary" data-source-loc="src\/App\.jsx:5:8" variant="outline">/);
  // class 再替换
  code = patchElementClass(code, 'src/App.jsx:5:8', 'btn-ghost');
  assert.match(code, /className="btn-ghost"/);
  assert.doesNotMatch(code, /btn-primary/);
  // style（Phase 2 语义：合并进已有 style={{...}}，同名字段覆盖、其余保留）
  code = patchElementStyle(code, 'src/App.jsx:4:8', { color: '#ff0000', fontSize: '20px' });
  assert.match(code, /style=\{\{ margin: '0' , "color": "#ff0000", "fontSize": "20px" \}\}/);
  assert.match(code, /margin: '0'/); // 原有字段保留
  // findElementByLoc
  const el = findElementByLoc(code, 'src/App.jsx:5:8');
  assert.equal(el.tag, 'Button');
  assert.equal(findElementByLoc(code, 'src/App.jsx:99:1'), null);
  // 非文本子元素拒绝 text patch
  const nested = `<div>\n  <span data-source-loc="src/App.jsx:2:4"><b>x</b></span>\n</div>\n`;
  assert.throws(() => patchElementText(nested, 'src/App.jsx:2:4', 'y'), /non-text children/);
});

test('generatePage 端到端：生成→写入→HTTP 取到渲染模块', async () => {
  const sbx = new ProjectSandbox({ rootDir: path.join(tmp, 'gen1') });
  await sbx.create();
  const provider = new MockProvider();
  const { file, code } = await generatePage({ sandbox: sbx, provider, userPrompt: '做一个登录页' });
  assert.equal(file, 'src/App.jsx');
  assert.match(code, /export default function App/);
  assert.match(code, /data-source-loc="src\/App\.jsx:\d+:\d+"/); // 已注入 loc
  // 落盘一致
  assert.equal(await sbx.readFile('src/App.jsx'), code);
  // HTTP：index 外壳 + 转译后模块可访问，且内容含生成标记
  const { url } = await sbx.start();
  try {
    const idx = await (await fetch(url)).text();
    assert.match(idx, /id="root"/);
    const appRes = await fetch(url + 'src/App.jsx');
    assert.equal(appRes.status, 200);
    const js = await appRes.text();
    assert.match(js, /h\(Card/);                       // JSX 已转译
    assert.match(js, /"data-source-loc"/);             // loc 透传到渲染层
    assert.match(js, /from '\/components\/ui\/button\.js'/); // 组件 import 已重写
    // 转译失败时 preview-server 会返回错误文档而非模块；此处证明拿到的是转译产物
    assert.doesNotMatch(js, /Transpile error/);
  } finally {
    await sbx.stop();
  }
});

test('Task 3.1：prompt 注入 DESIGN.md 全文 + antiPatterns；sandbox 自动初始化 DESIGN.md', async () => {
  const dmd = defaultDesignMd({ colors: { primary: '#5e6ad2' }, antiPatterns: ['no-blue-purple-gradient', 'no-one-off-hex-colors'] });
  const msgs = buildGenerationPrompt({ userPrompt: '做一个落地页', designMd: dmd });
  assert.match(msgs[0].content, /```markdown\n---\n/);          // 全文注入
  assert.match(msgs[0].content, /primary: "#5e6ad2"/);
  assert.match(msgs[0].content, /反模式/);
  assert.match(msgs[0].content, /no-one-off-hex-colors/);
  // sandbox 自动初始化
  const sbx = new ProjectSandbox({ rootDir: path.join(tmp, 'gen3') });
  await sbx.create();
  await assert.rejects(() => sbx.readFile('DESIGN.md'));       // 初始无 DESIGN.md
  await generatePage({ sandbox: sbx, provider: new MockProvider(), userPrompt: '做一个落地页' });
  const written = await sbx.readFile('DESIGN.md');             // 已自动写入默认
  assert.match(written, /primary: "#3f4a5a"/);
});

test('Task 3.1：同一 prompt + 不同 DESIGN.md → Mock 输出不同配色（确定性映射）', async () => {
  const provider = new MockProvider();
  const mkSandbox = async (name, primary) => {
    const sbx = new ProjectSandbox({ rootDir: path.join(tmp, name) });
    await sbx.create();
    await sbx.writeFile('DESIGN.md', defaultDesignMd({ colors: { primary } }));
    return sbx;
  };
  const a = await generatePage({ sandbox: await mkSandbox('genA', '#5e6ad2'), provider, userPrompt: '做一个落地页' });
  const b = await generatePage({ sandbox: await mkSandbox('genB', '#0ca678'), provider, userPrompt: '做一个落地页' });
  assert.notEqual(a.code, b.code);                             // 配色不同 → 输出不同
  assert.match(a.code, /design-tokens: primary=#5e6ad2/);      // token 注释
  assert.match(b.code, /design-tokens: primary=#0ca678/);
  assert.match(a.code, /background: '#5e6ad2'/);               // 主按钮注入主色背景
  assert.doesNotMatch(a.code, /#0ca678/);
  // 确定性：同输入再跑一次输出一致
  const a2 = await generatePage({ sandbox: await mkSandbox('genA2', '#5e6ad2'), provider, userPrompt: '做一个落地页' });
  assert.equal(a2.code, a.code);
});

test('generatePage 参数校验', async () => {
  const sbx = new ProjectSandbox({ rootDir: path.join(tmp, 'gen2') });
  await sbx.create();
  await assert.rejects(() => generatePage({ sandbox: sbx, provider: new MockProvider(), userPrompt: '' }), /userPrompt/);
});
