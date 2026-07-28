# TASK-3.1 校验日志 — DESIGN.md 规范与生成（Week7）

## 实现
- `packages/shared/src/design-md.js`
  - `defaultDesignMd(overrides)` 扩展至全字段：meta.name / colors(8 token) / typography(fontFamily+scale h1-h3,body,small) / spacing(unit+scale) / radius / shadows(sm,md,lg) / motion(duration,easing) / components(Button,Card 约定) / antiPatterns(列表)
  - body 新增对应各节：颜色 / 字体 / 间距与圆角 / 阴影与动效 / 组件约定 / 反模式 / 布局约定
  - 新增 `validateDesignMd(content): string[]`：校验 front matter 存在且可解析、meta.name、6 个核心 colors 存在且为合法 hex（3/4/6/8 位）、typography.fontFamily + scale.body、spacing.unit 为 `<n>px`、radius.md
- `packages/server/src/generate.js`
  - `buildGenerationPrompt` 注入「项目当前 DESIGN.md 全文（markdown 围栏）+ 反模式清单 + 主色摘要 + 全局约束」
  - `generatePage` sandbox 初始化：DESIGN.md 不存在则自动写入 `defaultDesignMd()`
  - `extractCode` 保留 `/* design-tokens: ... */` 头注释（不被 import 截断）
- `packages/shared/src/llm.js`
  - `extractPrimaryColor(text)`：从注入的 DESIGN.md YAML 中解析 `colors.primary`（兼容单/双引号）
  - `applyDesignTokens(code, primary)`：确定性映射——头部注入 token 注释 + 无 style 的默认 Button 注入主色背景/边框
  - MockProvider 页面路由后统一过 `applyDesignTokens`

## 验收（同 prompt × 不同 DESIGN.md → 不同配色）
测试 `Task 3.1：同一 prompt + 不同 DESIGN.md → Mock 输出不同配色`：
- primary=#5e6ad2 与 #0ca678 两项目生成代码 `assert.notEqual`
- 各自含 `design-tokens: primary=<hex>` 注释与 `background: '<primary>'` 主按钮样式
- 同输入重复生成输出完全一致（确定性）

## 校验命令与结果
```
npm test                    # 64 tests / 64 pass / 0 fail（shared 11, server 50, editor 3）
node scripts/smoke-phase1.mjs   # PASS
node scripts/smoke-phase2.mjs   # PASS
```
新增测试：shared.test.js +2（validateDesignMd 正反例，含 hex 3 位/非法 'red'/缺段/spacing.unit 非 px），generate.test.js +2（prompt 全文注入+sandbox 自动初始化；双 DESIGN.md 配色差异断言）。

## 已知限制
- MockProvider 主色映射只覆盖「无 style 的默认 Button」与头注释；真实 LLM 路径由 prompt 全文注入驱动。
- mini-YAML 子集不支持行内注释与多行字符串（DESIGN.md 生成路径不产出这些）。
