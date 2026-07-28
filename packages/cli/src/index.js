#!/usr/bin/env node
/**
 * draftly — AI 设计工具 CLI（Phase 4，SPEC 2.4）。
 *
 * 命令：
 *   draftly init [--dir <path>] [--dry-run]           检测已有项目，生成 DESIGN.md / component-registry.json
 *   draftly bridge --target <url> [--port <n>] [--dir <path>]
 *                                                 启动桥接代理（注入 inspect 脚本 + /bridge/file API）
 *   draftly sync --to-local|--from-local|--compare [--strategy overwrite|merge|patch]
 *            [--draft <dir>] [--local <dir>]      草稿 ↔ 本地双向同步
 *
 * 离线约束：无 commander/ink，参数解析用 node:util parseArgs 手写。
 */
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `draftly — AI 设计工具 CLI

用法:
  draftly <command> [options]

命令:
  init      检测已有项目并生成 DESIGN.md / component-registry.json
  bridge    启动桥接代理：转发目标 dev server，HTML 注入 inspect 脚本，暴露 /bridge/file
  sync      草稿与本地项目双向同步（overwrite / merge / patch）

运行 'draftly <command> --help' 查看子命令选项。`;

const INIT_HELP = `draftly init — 检测已有项目并生成设计契约文件

用法:
  draftly init [--dir <path>] [--dry-run]

选项:
  --dir <path>   项目根目录（默认：当前目录）
  --dry-run      只打印检测结果与将要写入的内容，不落盘
  -h, --help     显示本帮助`;

const BRIDGE_HELP = `draftly bridge — 启动桥接代理服务

用法:
  draftly bridge --target <url> [--port <n>] [--dir <path>]

选项:
  --target <url>  目标 dev server（如 http://localhost:3000），必填
  --port <n>      桥接监听端口（默认 4600）
  --dir <path>    本地项目根（/bridge/file 读写范围，默认：当前目录）
  -h, --help      显示本帮助

说明: HTML 响应注入 inspect 脚本（与编辑器 postMessage 协议一致）；
      HMR 走 SSE 降级通道 /__bridge-hmr（watch 本地目录 → reload 事件）。`;

const SYNC_HELP = `draftly sync — 草稿与本地项目双向同步

用法:
  draftly sync (--to-local | --from-local | --compare) [options]

方向（三选一，必填）:
  --to-local     草稿 → 本地（--strategy 生效，默认 merge）
  --from-local   本地 → 草稿（反向拷贝并更新草稿 DESIGN.md）
  --compare      只比较差异，不改动任何文件

选项:
  --strategy <s>  overwrite | merge | patch（仅 --to-local，默认 merge）
  --draft <dir>   草稿目录（默认：当前目录/.draftly/draft）
  --local <dir>   本地项目目录（默认：当前目录）
  -h, --help      显示本帮助`;

function fail(msg, help, code = 1) {
  console.error(`错误: ${msg}\n\n${help}`);
  process.exit(code);
}

async function cmdInit(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) { console.log(INIT_HELP); return; }
  const dir = path.resolve(values.dir || process.cwd());
  const { detectProject, generateDesignMdFromDetection, generateRegistryFromDetection } = await import('./detect.js');
  const { validateDesignMd } = await import('../../shared/src/design-md.js');
  const { validateRegistry } = await import('../../shared/src/registry.js');

  const detection = detectProject(dir);
  const designMd = generateDesignMdFromDetection(detection);
  const registry = generateRegistryFromDetection(detection);

  const mdErrors = validateDesignMd(designMd);
  if (mdErrors.length) fail(`生成的 DESIGN.md 未通过校验: ${mdErrors.join('; ')}`, INIT_HELP);
  const regErrors = validateRegistry(registry);
  if (regErrors.length) fail(`生成的 component-registry.json 未通过校验: ${regErrors.join('; ')}`, INIT_HELP);

  console.log(`项目检测结果 (${dir}):`);
  console.log(`  framework:      ${detection.framework}`);
  console.log(`  styling:        ${detection.styling}`);
  console.log(`  componentsDir:  ${detection.componentsDir ?? '(未找到)'}`);
  console.log(`  components:     ${detection.components.length} 个文件`);
  console.log(`  cssVars:        ${Object.keys(detection.cssVars).length} 个变量`);
  console.log(`  tailwindColors: ${detection.tailwindConfig ? Object.keys(detection.tailwindConfig.colors).length : 0} 个色值`);

  if (values['dry-run']) {
    console.log('\n--- DESIGN.md (dry-run) ---\n' + designMd);
    console.log('--- component-registry.json (dry-run) ---\n' + JSON.stringify(registry, null, 2));
    return;
  }
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), designMd);
  fs.writeFileSync(path.join(dir, 'component-registry.json'), JSON.stringify(registry, null, 2) + '\n');
  console.log('\n已写入: DESIGN.md, component-registry.json');
}

async function cmdBridge(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      target: { type: 'string' },
      port: { type: 'string', default: '4600' },
      dir: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) { console.log(BRIDGE_HELP); return; }
  if (!values.target) fail('缺少 --target <url>', BRIDGE_HELP);
  const { startBridge } = await import('./bridge.js');
  const { url } = await startBridge({
    target: values.target,
    port: Number(values.port),
    projectDir: path.resolve(values.dir || process.cwd()),
  });
  console.log(`draftly bridge 已启动: ${url} → ${values.target}`);
  console.log('编辑器 iframe 指向该地址即可 Inspect；Ctrl+C 退出。');
}

async function cmdSync(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'to-local': { type: 'boolean', default: false },
      'from-local': { type: 'boolean', default: false },
      compare: { type: 'boolean', default: false },
      strategy: { type: 'string', default: 'merge' },
      draft: { type: 'string' },
      local: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) { console.log(SYNC_HELP); return; }
  const dirs = [values['to-local'], values['from-local'], values.compare].filter(Boolean).length;
  if (dirs !== 1) fail('--to-local / --from-local / --compare 必须且只能选一个', SYNC_HELP);
  if (!['overwrite', 'merge', 'patch'].includes(values.strategy)) {
    fail(`未知 strategy: ${values.strategy}（可选 overwrite|merge|patch）`, SYNC_HELP);
  }
  const cwd = process.cwd();
  const draftDir = path.resolve(values.draft || path.join(cwd, '.draftly', 'draft'));
  const localDir = path.resolve(values.local || cwd);
  const sync = await import('./sync.js');

  if (values.compare) {
    const { diffs } = await sync.compareDraftLocal({ draftDir, localDir });
    if (!diffs.length) { console.log('无差异（compare 干净）'); return; }
    for (const d of diffs) {
      console.log(`${d.kind.padEnd(9)} ${d.file}  (${d.hunks.length} hunk)`);
      for (const h of d.hunks) console.log(`  - ${h.removed ?? ''}\n  + ${h.added ?? ''}`);
    }
    return;
  }
  const report = values['to-local']
    ? await sync.syncDraftToLocal({ draftDir, localDir, strategy: values.strategy })
    : await sync.createDraftFromLocal({ localDir, draftDir });
  console.log(`SyncReport (${report.strategy}):`);
  console.log(`  changed:   ${report.changed.length ? report.changed.join(', ') : '(无)'}`);
  console.log(`  skipped:   ${report.skipped.length ? report.skipped.join(', ') : '(无)'}`);
  console.log(`  conflicts: ${report.conflicts.length ? report.conflicts.join(', ') : '(无)'}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'init': return cmdInit(rest);
    case 'bridge': return cmdBridge(rest);
    case 'sync': return cmdSync(rest);
    case undefined:
    case '--help':
    case '-h': console.log(HELP); return;
    default: fail(`未知命令: ${cmd}`, HELP, 1);
  }
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((e) => { console.error('draftly 失败:', e.message); process.exit(1); });
}

export { cmdInit, cmdBridge, cmdSync };
