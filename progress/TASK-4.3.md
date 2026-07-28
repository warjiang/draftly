# TASK-4.3 校验日志 — 双向同步（Week12）

## 实现
- `packages/cli/src/sync.js`（SPEC 2.4 契约）：
  - `syncDraftToLocal({ draftDir, localDir, strategy })` → SyncReport `{ strategy, changed, skipped, conflicts }`
    - **overwrite**：草稿整文件覆盖本地（不删除 local 独有文件，非破坏性）。
    - **merge**：草稿 UI 结构为准，但 local 的 `// @draftly-preserve-start/end` 标记块内容存活：草稿有同 key 标记块 → 仅替换块内内容（标记行含缩进原样保留）；草稿没有 → local 块整体追加文件尾。块不配对 → conflicts + 该文件回退 overwrite。
    - **patch**：仅同步 className 差异。`extractLocClasses` 扫草稿开标签取 `{ data-source-loc → className }`（loc 是 local 坐标，不可用于定位草稿内标签——故按标签扫描），再用 server ast.js `patchElementClass` 对齐 local 元素 class；逻辑代码/其余属性不动；loc 对不上或 patch 失败 → conflicts；class 全一致 → skipped。
  - `createDraftFromLocal({ localDir, draftDir })`：反向拷贝代码文件（.js/.jsx/.ts/.tsx/.css/.vue/.svelte，跳过 node_modules/.git/dist/.draftly）+ 更新草稿 DESIGN.md（本地有则拷贝，否则 detectProject 检测生成）。
  - `compareDraftLocal({ draftDir, localDir })` → `{ diffs: [{ file, kind: 'added'|'removed'|'modified', hunks }] }`，hunks 为 LCS 行级 diff 的连续变更段 `{ removed, added }`（removed=local 侧，added=draft 侧）。
  - CLI：`draftly sync --to-local|--from-local|--compare [--strategy merge] [--draft] [--local]`（三选一强制校验，默认 draft=.draftly/draft、local=cwd）。
- `scripts/smoke-phase4.mjs`：init fixture → bridge 注入断言（inspect/CSS 透传//bridge/file）→ from-local 建草稿 → 改草稿 → to-local merge → 本地更新且 preserve 存活 → compare 干净。

## 校验命令与结果
```
node --test packages/cli/test/          # 28/28 pass（detect 9, cli-init 3, bridge 4, sync 9, cli-sync 2, 含三策略全覆盖）
npm test                                 # 106/106 pass（cli 28, editor 4, server 65, shared 9）
node scripts/smoke-phase{1,2,3,4}.mjs    # PASS / PASS / PASS / PASS
```
三策略断言点：overwrite 覆盖（含 preserve 也被覆盖 + 幂等 skipped）；merge 保留 preserve 块（含同名块内容替换、块不配对 conflict 回退）；patch 只改 class 不动逻辑（doNotTouch 保留、幂等 skipped、loc 对不上 conflict 不动文件）；compare 检出 added/removed/modified（hunks 精确到变更行）。

## 已知限制
- sync 为非破坏性：不删除 local 独有文件，故 compare 的 'removed'（仅 local 有）在 to-local 后仍会出现；如需镜像需人工删除。
- patch 策略仅对齐字符串字面量形态的 className；cn()/clsx() 形态经 ast.js 追加 token 处理，模板字符串/变量表达式记 conflict。
- preserve 块按标记行文本（trim 后）匹配，多块需用不同标记文本区分（如 `// @draftly-preserve-start auth`）。
