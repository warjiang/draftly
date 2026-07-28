import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectSandbox } from '../src/sandbox.js';
import { transformJsx, wrapPreviewModule } from '../src/jsx.js';

let tmp;
before(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-sbx-')); });
after(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

async function httpGet(url) {
  const res = await fetch(url);
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
}

test('create() 生成项目骨架', async () => {
  const sbx = new ProjectSandbox({ rootDir: path.join(tmp, 'p1') });
  await sbx.create();
  const files = await sbx.listFiles();
  assert.ok(files.includes('src/App.jsx'));
  assert.ok(files.includes('package.json'));
});

test('writeFile/readFile/listFiles', async () => {
  const sbx = new ProjectSandbox({ rootDir: path.join(tmp, 'p2') });
  await sbx.create();
  await sbx.writeFile('src/hello.txt', 'hello-世界');
  assert.equal(await sbx.readFile('src/hello.txt'), 'hello-世界');
  const files = await sbx.listFiles();
  assert.ok(files.includes('src/hello.txt'));
  // 目录穿越防护
  await assert.rejects(() => sbx.readFile('../outside.txt'), /escapes/);
});

test('start → HTTP 可取到内容 → stop', async () => {
  const sbx = new ProjectSandbox({ rootDir: path.join(tmp, 'p3') });
  await sbx.create();
  await sbx.writeFile('src/App.jsx', `export default function App() {
  return (
    <div className="page">
      <h1>Hello Sandbox</h1>
      <Button variant="outline">{'点击'}</Button>
      <>
        <span>{1 + 2}</span>
        <input type="text" placeholder="name" />
      </>
    </div>
  );
}
function Button(props) { return <button className={props.variant}>{props.children}</button>; }
`);
  assert.equal(sbx.isRunning(), false);
  const { port, url } = await sbx.start();
  assert.equal(sbx.isRunning(), true);
  assert.ok(port > 0);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\//);

  // 外壳 HTML
  const idx = await httpGet(url);
  assert.equal(idx.status, 200);
  assert.match(idx.text, /id="root"/);
  assert.match(idx.text, /__inspect\.js/); // inspect 注入点存在
  assert.match(idx.text, /__hmr/);         // HMR-lite 注入

  // 转译后的 App 模块：包含 h() 调用与 render 引导
  const app = await httpGet(url + 'src/App.jsx');
  assert.equal(app.status, 200);
  assert.match(app.type, /javascript/);
  assert.match(app.text, /h\("h1",\s*null,\s*"Hello Sandbox"\)/);
  assert.match(app.text, /render\(h\(App/);

  // runtime / inspect 占位
  const rt = await httpGet(url + '__runtime.js');
  assert.match(rt.text, /export function h/);
  const insp = await httpGet(url + '__inspect.js');
  assert.match(insp.text, /__DRAFTLY_INSPECT__/);

  // 文件变更后再次请求拿到新内容
  await sbx.writeFile('src/App.jsx', `export default function App() { return <p>v2 content</p>; }\n`);
  const app2 = await httpGet(url + 'src/App.jsx');
  assert.match(app2.text, /v2 content/);

  // restart
  const r2 = await sbx.restart();
  assert.ok(r2.port > 0);
  assert.equal(sbx.isRunning(), true);

  await sbx.stop();
  assert.equal(sbx.isRunning(), false);
  await assert.rejects(() => httpGet(url));
});

test('内置 registry 组件模块可访问', async () => {
  const sbx = new ProjectSandbox({ rootDir: path.join(tmp, 'p4') });
  await sbx.create();
  const { url } = await sbx.start();
  const btn = await httpGet(url + 'components/ui/button.js');
  assert.equal(btn.status, 200);
  assert.match(btn.text, /export function Button/);
  const nope = await httpGet(url + 'components/ui/nonexist.js');
  assert.equal(nope.status, 404);
  await sbx.stop();
});

test('jsx 转译器单元行为', () => {
  // 属性三种形态 + 嵌套表达式 JSX + fragment
  const out = transformJsx(`const x = <Card title="t" hidden data-loc={'a:1:2'}>{ok ? <B/> : 'no'}</Card>;`);
  assert.match(out, /h\(Card,\{"title":"t","hidden":true,"data-loc":\('a:1:2'\)\}/);
  assert.match(out, /\(ok \? h\(B,null\) : 'no'\)/);
  // 自闭合 + 字符串里的 < 不误判
  const out2 = transformJsx(`const s = "<div>"; const y = cond && <img src="a.png" />;`);
  assert.match(out2, /const s = "<div>"/);
  assert.match(out2, /h\("img",\{"src":"a\.png"\}\)/);
  // 错配标签报错
  assert.throws(() => transformJsx('const z = <div></span>;'), /mismatched/);
});

test('wrapPreviewModule 处理 import/export', () => {
  const wrapped = wrapPreviewModule(`import { Button } from '@/components/ui/button';
export default function App() { return <Button>Hi</Button>; }
`);
  assert.match(wrapped, /from '\/components\/ui\/button\.js'/);
  assert.match(wrapped, /import \{ h, render, Fragment \} from '\/__runtime\.js'/);
  assert.match(wrapped, /render\(h\(App, null\)/);
  assert.doesNotMatch(wrapped, /export default/);
});
