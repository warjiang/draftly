/**
 * smoke-phase4.mjs — Phase 4 全流程（实际运行）：
 *   ① draftly init fixture 项目 → DESIGN.md/component-registry.json 落盘
 *   ② 模拟 target dev server + draftly bridge → HTML 注入 inspect 脚本，CSS 透传
 *   ③ draftly sync --from-local 建草稿 → 修改草稿 → --to-local --strategy merge
 *     → 本地文件更新且 preserve 块存活 → --compare 干净
 * 运行：node scripts/smoke-phase4.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startBridge } from '../packages/cli/src/bridge.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages', 'cli', 'src', 'index.js');
const FIXTURE = path.join(ROOT, 'packages', 'cli', 'test', 'fixtures', 'react-tailwind-app');
const run = (args, cwd) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd });

const ok = (cond, msg) => {
  if (!cond) { console.error(`  ✗ ${msg}`); process.exit(1); }
  console.log(`  ✓ ${msg}`);
};

const APP = `export function App() {
  const [n, setN] = useState(0);
  return <div data-source-loc="src/App.jsx:3:10" className="page">Home</div>;
  // @draftly-preserve-start
  const api = fetch('/api/legacy');
  // @draftly-preserve-end
}
`;

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'draftly-smoke4-'));
  const app = path.join(work, 'app');
  fs.cpSync(FIXTURE, app, { recursive: true });
  fs.writeFileSync(path.join(app, 'src', 'App.jsx'), APP);
  console.log(`workdir: ${work}`);

  /* ① init */
  console.log('\n[1/4] draftly init');
  const initOut = run(['init', '--dir', app], app);
  ok(/framework:\s+react/.test(initOut) && /styling:\s+tailwind/.test(initOut), 'init 检测 react + tailwind');
  ok(fs.readFileSync(path.join(app, 'DESIGN.md'), 'utf8').includes('#3b6ea5'), 'DESIGN.md 含检测色值');
  ok(JSON.parse(fs.readFileSync(path.join(app, 'component-registry.json'), 'utf8')).components.length >= 1, 'registry 含扫描组件');

  /* ② bridge */
  console.log('\n[2/4] draftly bridge 注入');
  const target = http.createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body><h1>app</h1></body></html>'); }
    else { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end('body{color:red}'); }
  });
  await new Promise((r) => target.listen(0, r));
  const bridge = await startBridge({ target: `http://localhost:${target.address().port}`, port: 0, projectDir: app, log: () => {} });
  const html = await (await fetch(`${bridge.url}/`)).text();
  ok(html.includes('__DRAFTLY_INSPECT__') && html.includes('draftly:inspect:select'), 'bridge HTML 注入 inspect 脚本');
  const css = await (await fetch(`${bridge.url}/x.css`)).text();
  ok(css === 'body{color:red}', 'bridge CSS 透传');
  const f = await (await fetch(`${bridge.url}/bridge/file?path=${encodeURIComponent('src/App.jsx')}`)).json();
  ok(f.content.includes('data-source-loc'), '/bridge/file GET 读项目文件');

  /* ③ sync */
  console.log('\n[3/4] draftly sync 全流程');
  run(['sync', '--from-local'], app);
  const draftApp = path.join(app, '.draftly', 'draft', 'src', 'App.jsx');
  ok(fs.readFileSync(draftApp, 'utf8') === APP, '--from-local 建立草稿');
  fs.writeFileSync(draftApp, APP.replace('className="page"', 'className="page-v2"'));
  const syncOut = run(['sync', '--to-local', '--strategy', 'merge'], app);
  ok(syncOut.includes('src/App.jsx'), '--to-local merge 有变更');
  const merged = fs.readFileSync(path.join(app, 'src', 'App.jsx'), 'utf8');
  ok(merged.includes('className="page-v2"'), '本地文件已更新（草稿 UI 为准）');
  ok(merged.includes("fetch('/api/legacy')"), 'preserve 块存活');
  ok(merged.includes('useState'), '草稿外逻辑不受影响（草稿保留）');

  /* ④ compare 干净 */
  console.log('\n[4/4] draftly sync --compare');
  const cmp = run(['sync', '--compare'], app);
  ok(/无差异/.test(cmp), 'compare 干净');

  await bridge.stop();
  target.close();
  console.log('\nSMOKE PHASE 4: PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
