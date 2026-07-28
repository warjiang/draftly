# TASK M1.1 — HTML 设计草稿：生成即所见

对应规划：docs/html-draft-plan.md（M1 里程碑）

## 实现内容

| 模块 | 说明 |
| --- | --- |
| `packages/server/src/draft-prompts.js` | 草稿生成 Prompt（设计师角色、单文件 HTML 硬性约束、DESIGN.md 契约注入） |
| `packages/server/src/html-post.js` | 输出后处理：`extractHtml`（围栏/杂谈容错）、`sanitizeHtml`（去 script/on*/javascript:）、`injectDataIds`（body 元素注入 data-did，幂等） |
| `packages/server/src/drafts.js` | `DraftStore`：草稿/版本落盘 `.draftly/drafts/<id>/v<N>.html` + `meta.json` |
| `packages/server/src/draft-generate.js` | 生成管线：1–3 变体并行（temperature 0.2/0.5/0.8 拉开）→ 后处理 → 落盘 |
| `packages/server/src/http.js` | 新增 `POST /api/draft/generate`、`GET /api/drafts`、`GET /api/draft/:id?v=N`（不依赖 sandbox） |
| `packages/shared/src/llm.js` | `DRAFT_PROMPT_MARKER`；MockProvider 返回确定性整页 HTML（登录/落地页/仪表盘/通用），DESIGN.md primary 整体替换主色 |
| `packages/editor/public/drafts.html` + `drafts-app.js` + `drafts.css` | 新草稿编辑器：顶栏输入 + 变体数、左侧草稿列表、srcdoc 预览、源码弹层；旧版编辑器加入口链接 |
| `packages/server/test/drafts.test.js` | 8 个测试：后处理三件套 / Prompt / Mock 确定性 / DraftStore / 多变体管线 / HTTP 集成 |

## 验证命令与结果

```bash
npm test          # 113 tests, 0 fail（含 drafts.test.js 8 个）
npm run smoke     # PHASE 1-4 全部 PASS（旧 API 未受影响）
```

端到端（Mock 模式，`DRAFTLY_LLM_API_KEY=` 置空启动）：

```
POST /api/draft/generate {"prompt":"做一个深色科技感的 SaaS 定价页","variants":3}
→ 200 {"drafts":[{id,title,version:1} ×3]}
GET /api/drafts        → 3 条 meta，倒序
GET /api/draft/<id>    → v1 HTML：<!doctype html> 开头、含 data-did、无 <script>
落盘确认：.draftly/drafts/<id>/{meta.json,v1.html}
```

真实 LLM 模式（glm-5.2 via 127.0.0.1:4141）已配置 `.env` 并验证服务启动加载（LLM 服务当时未运行，请求路径 502 行为符合预期；管线其余部分由 Mock 全量覆盖）。

## 结论

PASS。M1「生成即所见」完成：一句话 → 1~3 个 HTML 草稿 → srcdoc 直渲染（零转译）→ 版本落盘。
