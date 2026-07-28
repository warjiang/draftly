# TASK-2.2 — Week5 AST 精准修改强化

## 实现（packages/server/src/ast.js，行扫描内核强化，接口形状同 SPEC 2.2）
- 新增括号/引号感知扫描工具：`matchBracket`（跳过字符串与嵌套）、`stringLiterals`、`splitTopLevel`。
- `patchElementClass` 三种 className 形态：
  1. `className="..."` 字符串字面量 → 整体替换值；
  2. `className={cn("a", cond && "b")}` → 比对字符串参数 token，仅追加缺失 token 为新字符串参数，
     条件/表达式参数不动，全部已存在则无变化（幂等）；
  3. `clsx(...)` 同 ②。无 className → 标签名后新建；`className={styles.x}` 等非 cn/clsx 表达式显式报错。
- `patchElementStyle`：已有 `style={{ ... }}` → 解析对象字面量顶层字段，同名字段覆盖、
  其余字段**原文保留**（含空白），新字段追加；`style={expr}` 显式报错；无 style → 新建。
- `patchElementText`：保留 Phase 1 保护（含表达式/子元素显式报错）。
- `injectSourceLoc` 增强：lookahead 不消耗下一字符，兼容 `<Tag` 位于行尾的多行开标签（幂等性保持）。
- /api/patch：`type: 'style'` 已接入（Phase 1 路由表已含），patch 前 history().mutate 快照（已有）。

## 格式保留
所有 patch 仅替换 loc 指向的开标签/文本区间，其余字节不动；测试用「行级 diff 行数断言」验证
（assertOnlyLinesChanged：行数不变且仅目标行变化）。

## 校验
- `node --test packages/server/test/ast.test.js`（新增 15 项）：三形态 + 幂等 + 无 className 新建 +
  非 cn/clsx 报错 + style 合并/新建/expr 报错 + text 保护 + 多行开标签 + 嵌套同名元素不串扰 +
  matchBracket —— 全绿。
- `npm test`：editor 2/2、server 43/43、shared 7/7 全绿。
  - 说明：Phase 1 两处旧断言（generate.test.js / http.test.js）原假设「style 整体替换」，
    已按 Phase 2 合并语义更新断言（marginTop/margin 字段保留），其余 Phase 1 测试未动。
- `node scripts/smoke-phase2.mjs`：PASS（新增 class 新建、style 合并、仅目标行变化、undo 逐步还原）。
- `node scripts/smoke-phase1.mjs`：PASS。
- 注：一次全量跑中 http.test.js 单文件失败但单独重跑通过（/mnt 挂载延迟导致的临时目录读抖动），
  复跑全量 43/43 全绿。

## 降级/说明
- recast/@babel 离线不可安装：沿用行扫描内核并强化为括号/引号感知；接口保持 SPEC 2.2 形状，
  未来可平滑替换内核。已在本文件与 ast.js 头注释注明。
- 结论：PASS
