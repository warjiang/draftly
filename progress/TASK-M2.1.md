# TASK M2.1 — HTML 设计草稿：对话迭代 + 版本历史

对应规划：docs/html-draft-plan.md（M2 里程碑）

## 实现内容

| 模块 | 说明 |
| --- | --- |
| `packages/server/src/draft-prompts.js` | 新增 `buildIteratePrompt({ currentHtml, instruction })`，注入 `ITERATE_PROMPT_MARKER` |
| `packages/server/src/draft-generate.js` | 新增 `iterateDraft({ drafts, provider, id, instruction })`：读取最新版本 → LLM 迭代 → 后处理 → 存 v(N+1) |
| `packages/server/src/drafts.js` | 新增 `DraftStore.rollbackVersion(id, v)`：删除 v 之后版本文件并截断 `meta.versions` |
| `packages/server/src/http.js` | 新增 `POST /api/draft/:id/iterate` 与 `POST /api/draft/:id/rollback` |
| `packages/shared/src/llm.js` | 新增 `ITERATE_PROMPT_MARKER`；MockProvider 支持迭代模式，按关键词做确定性 HTML 小修改 |
| `packages/editor/public/drafts.html` | 右侧新增「迭代」输入框 +「版本历史」列表 |
| `packages/editor/public/drafts-app.js` | 新增迭代提交、版本列表渲染、点击历史版本预览、回退按钮 |
| `packages/editor/public/drafts.css` | 三栏布局、迭代/版本列表样式 |
| `packages/server/test/drafts.test.js` | 新增 iterateDraft / rollbackVersion / HTTP 端点集成测试 |

## 验证命令与结果

```bash
npm test          # 全部 pass（ drafts.test.js 10 个，0 fail）
npm run smoke     # PHASE 1-4 全部 PASS（旧 API 未受影响）
```

端到端（Mock 模式）：

```
POST /api/draft/generate {"prompt":"做一个仪表盘","variants":1}
→ {"drafts":[{"id":"...","version":1}]}

POST /api/draft/:id/iterate {"instruction":"改成深色模式"}
→ {"id":"...","version":2}

GET /api/draft/:id
→ version: 2, versions: 2

POST /api/draft/:id/rollback {"v":1}
→ {"id":"...","version":1}

GET /api/draft/:id
→ version: 1, versions: 1
```

前端：
- `http://127.0.0.1:4173/drafts.html` 现在为三栏布局
- 选中草稿后，右栏显示「迭代」输入框与「版本历史」
- 点击历史版本可预览该版本；非当前版本显示「回退」按钮

## 结论

PASS。M2「对话迭代 + 版本历史」完成。
