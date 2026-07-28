/**
 * sync.js — 草稿 ↔ 本地项目双向同步（SPEC 2.4，Phase 4 / Week12）。
 *
 * 语义：
 *  - syncDraftToLocal({ draftDir, localDir, strategy })
 *      overwrite：草稿文件整文件覆盖本地同名文件（本地独有内容丢弃）。
 *      merge：以草稿 UI 结构为准，但保留 local 文件中
 *        `// @draftly-preserve-start` ... `// @draftly-preserve-end` 标记块的内容：
 *        草稿有同名标记块 → 块内内容用 local 的；草稿没有 → local 标记块整体追加到文件尾。
 *        标记块不配对（start 无 end）→ 记入 conflicts，该文件回退 overwrite。
 *      patch：仅同步 style/className 差异。按草稿中的 data-source-loc 对齐本地元素，
 *        用 @draftly/server ast.js 的 patchElementClass 把本地元素 className 改成草稿值；
 *        逻辑代码/其余属性一律不动；loc 对不上 → conflicts。
 *  - createDraftFromLocal({ localDir, draftDir })：反向拷贝代码文件
 *      （.js/.jsx/.ts/.tsx/.css/.vue/.svelte，跳过 node_modules/.git/dist/.draftly）到 draftDir，
 *      并更新草稿 DESIGN.md（本地有则拷贝，否则由 detectProject 生成）。
 *  - compareDraftLocal({ draftDir, localDir })：逐文件行级 diff，
 *      → { diffs: [{ file, kind: 'added'|'removed'|'modified', hunks: [{ removed, added }] }] }
 *      added=仅草稿有，removed=仅本地有，modified=两边都有但内容不同。
 *
 * SyncReport = { strategy, changed: string[], skipped: string[], conflicts: string[] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { findOpeningTag, patchElementClass } from '../../server/src/ast.js';
import { detectProject, generateDesignMdFromDetection } from './detect.js';

const CODE_EXT_RE = /\.(jsx?|tsx?|css|vue|svelte)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.draftly']);
const PRESERVE_START_RE = /^[ \t]*\/\/\s*@draftly-preserve-start\b.*$/;
const PRESERVE_END_RE = /^[ \t]*\/\/\s*@draftly-preserve-end\b.*$/;

/** 递归收集目录文件（相对路径，posix 风格，排序确定性） */
function walk(root, filter = () => true) {
  const out = [];
  const rec = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) rec(full);
      else if (filter(path.relative(root, full))) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  rec(root);
  return out.sort();
}

/** 提取 preserve 标记块列表 [{ startLine, endLine, key, lines }]；不配对 → 抛错 */
function extractPreserveBlocks(code) {
  const lines = code.split('\n');
  const blocks = [];
  let cur = null;
  lines.forEach((line, i) => {
    if (PRESERVE_START_RE.test(line)) {
      if (cur) throw new Error('preserve 块嵌套或未闭合');
      cur = { startLine: i, key: line.trim(), startRaw: line, lines: [] };
    } else if (PRESERVE_END_RE.test(line)) {
      if (!cur) throw new Error('@draftly-preserve-end 无对应 start');
      blocks.push({ ...cur, endLine: i, key: cur.key, endRaw: line });
      cur = null;
    } else if (cur) cur.lines.push(line);
  });
  if (cur) throw new Error('@draftly-preserve-start 无对应 end');
  return blocks;
}

/** merge 策略：草稿为准 + local preserve 块内容存活 */
export function mergeWithPreserve(draftCode, localCode) {
  const draftBlocks = extractPreserveBlocks(draftCode); // 不配对抛错 → 上层记 conflict
  const localBlocks = extractPreserveBlocks(localCode);
  if (localBlocks.length === 0) return draftCode;
  const draftLines = draftCode.split('\n');
  const appended = [];
  // 自底向上替换，避免行号偏移
  const replacements = [];
  for (const lb of localBlocks) {
    const db = draftBlocks.find((b) => b.key === lb.key);
    if (db) replacements.push({ db, lb });
    else appended.push(lb.startRaw, ...lb.lines, lb.endRaw);
  }
  replacements.sort((a, b) => b.db.startLine - a.db.startLine);
  for (const { db, lb } of replacements) {
    // 保留草稿原标记行（含缩进），仅替换块内内容
    draftLines.splice(db.startLine, db.endLine - db.startLine + 1, db.startRaw, ...lb.lines, db.endRaw);
  }
  let out = draftLines.join('\n');
  if (appended.length) out = out.replace(/\s*$/, '') + '\n\n' + appended.join('\n') + '\n';
  return out;
}

/** 从代码提取 { loc → className }：扫开标签中的 data-source-loc 与 className 字符串字面量
 * （loc 指向的是 local 文件坐标，不能用它定位草稿内的标签，故按标签整体扫描） */
export function extractLocClasses(code) {
  const map = new Map();
  const tagRe = /<[A-Za-z][A-Za-z0-9]*(?:\s+[^<>]*?)?>/gs;
  let m;
  while ((m = tagRe.exec(code))) {
    const tag = m[0];
    const lm = /data-source-loc="([^"]+)"/.exec(tag);
    if (!lm) continue;
    const cm = /className=("([^"]*)"|'([^']*)')/.exec(tag);
    if (cm) map.set(lm[1], cm[2] ?? cm[3] ?? '');
  }
  return map;
}

/** patch 策略：仅把 local 元素的 className 对齐草稿值 */
function patchClassesToLocal(draftCode, localCode, relFile) {
  const draftClasses = extractLocClasses(draftCode);
  const conflicts = [];
  let next = localCode;
  let touched = false;
  for (const [loc, draftClass] of draftClasses) {
    const pos = findOpeningTag(next, loc);
    if (!pos) { conflicts.push(`${relFile}: loc 对不上 ${loc}`); continue; }
    const tagSrc = next.slice(pos.start, pos.end);
    const cm = /className=("([^"]*)"|'([^']*)')/.exec(tagSrc);
    const localClass = cm ? (cm[2] ?? cm[3] ?? '') : null;
    if (localClass === draftClass) continue;
    if (!cm && !/className=\{/.test(tagSrc) && draftClass === '') continue;
    try {
      next = patchElementClass(next, loc, draftClass);
      touched = true;
    } catch (e) {
      conflicts.push(`${relFile}: patch ${loc} 失败: ${e.message}`);
    }
  }
  return { code: next, touched, conflicts };
}

/**
 * @param {{ draftDir: string, localDir: string, strategy?: 'overwrite'|'merge'|'patch' }} opts
 * @returns {Promise<{ strategy: string, changed: string[], skipped: string[], conflicts: string[] }>}
 */
export async function syncDraftToLocal({ draftDir, localDir, strategy = 'merge' }) {
  if (!['overwrite', 'merge', 'patch'].includes(strategy)) throw new Error(`unknown strategy: ${strategy}`);
  const report = { strategy, changed: [], skipped: [], conflicts: [] };
  const draftFiles = walk(draftDir);
  for (const rel of draftFiles) {
    const draftPath = path.join(draftDir, rel);
    const localPath = path.join(localDir, rel);
    const draftCode = fs.readFileSync(draftPath, 'utf8');
    const localExists = fs.existsSync(localPath);
    const localCode = localExists ? fs.readFileSync(localPath, 'utf8') : null;
    if (localExists && localCode === draftCode) { report.skipped.push(rel); continue; }

    let next = draftCode;
    if (strategy === 'merge' && localExists) {
      try {
        next = mergeWithPreserve(draftCode, localCode);
      } catch (e) {
        report.conflicts.push(`${rel}: preserve 块异常（${e.message}），回退 overwrite`);
        next = draftCode;
      }
    } else if (strategy === 'patch') {
      if (!localExists) { // 新文件：patch 无对齐目标，整写
        next = draftCode;
      } else {
        const r = patchClassesToLocal(draftCode, localCode, rel);
        report.conflicts.push(...r.conflicts);
        if (!r.touched) { report.skipped.push(rel); continue; }
        next = r.code;
      }
    }
    if (localExists && localCode === next) { report.skipped.push(rel); continue; }
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, next);
    report.changed.push(rel);
  }
  return report;
}

/**
 * 本地 → 草稿：拷贝代码文件 + 更新草稿 DESIGN.md。
 */
export async function createDraftFromLocal({ localDir, draftDir }) {
  const report = { strategy: 'from-local', changed: [], skipped: [], conflicts: [] };
  const files = walk(localDir, (rel) => CODE_EXT_RE.test(rel));
  for (const rel of files) {
    const src = path.join(localDir, rel);
    const dst = path.join(draftDir, rel);
    const content = fs.readFileSync(src, 'utf8');
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === content) { report.skipped.push(rel); continue; }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, content);
    report.changed.push(rel);
  }
  // DESIGN.md：本地有则拷贝，否则检测生成
  let designMd;
  const localMd = path.join(localDir, 'DESIGN.md');
  if (fs.existsSync(localMd)) designMd = fs.readFileSync(localMd, 'utf8');
  else designMd = generateDesignMdFromDetection(detectProject(localDir));
  const draftMd = path.join(draftDir, 'DESIGN.md');
  if (!fs.existsSync(draftMd) || fs.readFileSync(draftMd, 'utf8') !== designMd) {
    fs.mkdirSync(draftDir, { recursive: true });
    fs.writeFileSync(draftMd, designMd);
    report.changed.push('DESIGN.md');
  } else report.skipped.push('DESIGN.md');
  return report;
}

/** 行级 diff（LCS），输出 hunks [{ removed, added }]（连续变更段合并） */
export function diffLines(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;
  // LCS DP
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks = [];
  let i = 0;
  let j = 0;
  let cur = null;
  const flush = () => { if (cur) { hunks.push(cur); cur = null; } };
  while (i < n && j < m) {
    if (A[i] === B[j]) { flush(); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { cur = cur || {}; cur.removed = (cur.removed ? cur.removed + '\n' : '') + A[i]; i++; }
    else { cur = cur || {}; cur.added = (cur.added ? cur.added + '\n' : '') + B[j]; j++; }
  }
  while (i < n) { cur = cur || {}; cur.removed = (cur.removed ? cur.removed + '\n' : '') + A[i]; i++; }
  while (j < m) { cur = cur || {}; cur.added = (cur.added ? cur.added + '\n' : '') + B[j]; j++; }
  flush();
  return hunks;
}

/**
 * @returns {Promise<{ diffs: Array<{ file: string, kind: 'added'|'removed'|'modified', hunks: Array }> }>}
 */
export async function compareDraftLocal({ draftDir, localDir }) {
  const draftFiles = new Set(walk(draftDir));
  const localFiles = new Set(walk(localDir, (rel) => CODE_EXT_RE.test(rel) || rel === 'DESIGN.md'));
  const diffs = [];
  const all = [...new Set([...draftFiles, ...localFiles])].sort();
  for (const rel of all) {
    const inDraft = draftFiles.has(rel);
    const inLocal = localFiles.has(rel);
    if (inDraft && !inLocal) { diffs.push({ file: rel, kind: 'added', hunks: [] }); continue; }
    if (!inDraft && inLocal) { diffs.push({ file: rel, kind: 'removed', hunks: [] }); continue; }
    const a = fs.readFileSync(path.join(draftDir, rel), 'utf8');
    const b = fs.readFileSync(path.join(localDir, rel), 'utf8');
    if (a !== b) diffs.push({ file: rel, kind: 'modified', hunks: diffLines(b, a) }); // removed=local, added=draft
  }
  return { diffs };
}
