# TASK M4.1 — HTML 设计草稿：多变体与风格 + 导出

对应规划：docs/html-draft-plan.md（M4 里程碑）

## 实现内容

| 模块 | 说明 |
| --- | --- |
| `packages/server/src/http.js` | `/api/draft/generate` 支持 `style` 参数：指定时用模板库 `designMd` 作为设计契约（替代 sandbox DESIGN.md），unknown style → 400；新增 `GET /api/draft/:id/export`：最新版本整页下载（`Content-Disposition: attachment`） |
| `packages/server/src/draft-generate.js` | 多变体生成改 `Promise.allSettled` 容错：并发时个别失败（如网关 500）不拖垮整批，全部失败才抛第一个错误 |
| `packages/shared/src/llm.js` | **修复真实模型生成为空的 bug**：`OpenAICompatibleProvider` 补 `max_tokens`（默认 32768，`DRAFTLY_LLM_MAX_TOKENS` / `opts.maxTokens` 可覆盖）。根因：推理模型（reasoning_content）在代理默认 4k 预算内耗尽 token，`finish_reason: length` 且 content 为空 |
| `.env.example` | 补充 `DRAFTLY_LLM_MAX_TOKENS` 说明 |
| `packages/editor/public/drafts.html` | 顶栏风格预设下拉（`#gen-style`）；中栏多变体对比容器（`#compare-view`/`#compare-grid`）；「导出 HTML」按钮 |
| `packages/editor/public/drafts-app.js` | 启动时 `GET /api/templates` 填充风格下拉（`name（风格标签）`）；生成时带上 `style`；多变体（>1）生成后并排对比视图：iframe srcdoc 缩放缩略（300% × scale(1/3)，禁交互），点击卡片选用；单变体/选用后自动退出对比视图；导出按钮触发 `/export` 下载 |
| `packages/editor/public/drafts.css` | 对比网格（auto-fit minmax 320px）、缩略 iframe、卡片 hover 样式 |
| `packages/server/test/drafts.test.js` | 新增 2 个测试：M4 HTTP（模板列表 / unknown style 400 / 带 style 生成 / export 下载头与内容 / export 404）；多变体部分失败容错（allSettled 2/3 成功；全败抛错） |

## 关键设计

- **风格预设复用模板库**：`style` = 模板 id，直接把模板的 `designMd` 注入生成 prompt 作为设计契约，不触碰 sandbox DESIGN.md（草稿管线本就不依赖 sandbox）
- **对比视图不改草稿模型**：多变体本来就是 N 个独立草稿，对比只是中栏临时视图；未选用的方案保留在左栏草稿列表，可随时回看
- **缩略预览零依赖**：CSS `width:300% + scale(1/3)` 等效桌面视口截图，`pointer-events:none` 防误触，无需截图服务
- **allSettled 容错**：本地代理/网关在并发下偶发 500，部分成功即返回成功项，前端按返回数量自动降级（>1 对比 / =1 直接预览）

## 验证命令与结果

```bash
npm test          # 全部 pass，0 fail（drafts.test.js 17 个）
npm run smoke     # PHASE 1-4 全部 PASS
```

端到端（真实模型 glm-5.2，本地代理 :4141）：

```
POST /api/draft/generate {prompt, style:"stripe", variants:1}   → 200，完整深色定价页 HTML
POST /api/draft/generate {prompt, variants:2}                   → 200，2 个草稿
POST /api/draft/generate {style:"nope"}                         → 400 unknown style
GET  /api/draft/:id/export  → 200 Content-Disposition: attachment; filename="draftly-<id>-v1.html"
GET  /api/templates         → 10 个模板（驱动风格下拉）
```

## 结论

PASS。M4「多变体与风格」完成：风格预设（模板库设计契约）+ 并行多变体（容错）+ 并排对比选用 + HTML 导出。
至此规划 M1-M4 全部落地；剩余 M5（HTML→React 导出、截图分享、DESIGN.md 反向提取）为后续项。
