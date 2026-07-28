# TASK-3.3 校验日志 — 模板库（Week9）

## 实现
- **数据模型** `packages/server/src/templates.js` + `data/templates/*.json`：
  `{ id, name, sourceUrl, tags:{style[],industry[],color[]}, confidence:'curated', screenshot:null（占位，离线用色板替代）, designMd（全文，过 validateDesignMd） }`
  `validateTemplate` fail-fast；`loadTemplates` 文件名序确定性加载 + id 去重；`templateSummary` 列表摘要（附 colors 色板，不含全文）。
- **10 个预置模板**（人工策展，confidence=curated）：
  | id | primary | 基调 |
  |---|---|---|
  | linear | #5e6ad2 | 深色 / Inter / 8px |
  | stripe | #635bff | #f6f9fc 浅蓝灰 / 商务 |
  | notion | #2383e2 | 白底文档风 / radius 6 |
  | vercel | #0070f3 | 纯黑极简 / Geist |
  | airbnb | #ff385c | 活力红 / radius 12 |
  | apple | #0066cc | #f5f5f7 / radius 18 |
  | github | #1f6feb | #0d1117 深色 / radius 6 |
  | figma | #0d99ff | 现代 / accent #9747ff |
  | shopify | #008060 | 电商绿 / radius 8 |
  | tailwind | #0ea5e9 | 天蓝 / spacing 4px |
- **API**：`GET /api/templates`（摘要列表）、`GET /api/templates/:id`（含 designMd 全文，未知 id 404）、`POST /api/templates/apply {id, regenerate?, prompt?}`（history 写入 DESIGN.md 可 undo；regenerate 时用 MockProvider 确定性主色映射重新生成页面并入历史）。
- **编辑器**：左栏「组件 / 模板」双 Tab。模板 Tab：风格+颜色下拉筛选、卡片网格（`tpl-swatches` 用 designMd colors 画色块替代截图、名称、标签徽章、置信度、「应用」按钮）；应用后 iframe 刷新 + history 按钮刷新 + 可 Undo 提示。样式浅色低饱和、无渐变（editor.test 红线断言保持）。

## 校验命令与结果
```
node --test packages/server/test/templates.test.js   # 6/6 pass
npm test                                              # 78/78 pass（shared 11, server 63, editor 4）
node scripts/smoke-phase1.mjs / 2 / 3                 # PASS / PASS / PASS
```
smoke-phase3 全流程（实际运行 PASS）：extract fixture → 模板列表 → apply「Stripe」→ DESIGN.md 含 #635bff → 生成落地页含 `design-tokens: primary=#635bff` 与 `background: '#635bff'` → 两次 undo 还原默认 DESIGN.md。
另：更新旧占位断言 `design-md GET/PUT + registry + templates 端点形状`（10 模板 + 未知 id 404）。

## 已知限制
- 截图为 null 占位：离线无法截图，卡片用色板预览代替（数据模型已留字段）。
- 模板为人工策展值（非真实抓取）；置信度字段为后续 extract 落库（extracted-high/low）预留。
- apply 的 regenerate 复用 MockProvider 落地页模板；真实 LLM 下由 DESIGN.md 全文注入驱动。
