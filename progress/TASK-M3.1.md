# TASK M3.1 — HTML 设计草稿：点选局部修改

对应规划：docs/html-draft-plan.md（M3 里程碑）

## 实现内容

| 模块 | 说明 |
| --- | --- |
| `packages/server/src/html-edit.js`（新） | 零依赖标签扫描器：`findElementRange`（嵌套同名标签 depth 配对）、`extractElementHtml`、`replaceElementHtml`、`maxDataDid`、`ensureRootDid`（根元素 data-did 补回）、`extractElementFragment`（围栏/杂谈容错） |
| `packages/server/src/html-post.js` | 拆出 `tagWithDataIds`；新增 `injectFragmentDataIds(fragment, startFrom)`，片段内新元素从文档最大 did 续号，避免冲突 |
| `packages/server/src/draft-prompts.js` | 新增 `buildEditElementPrompt`（`EDIT_ELEMENT_PROMPT_MARKER`；要求保留 data-did、只输出替换元素 outerHTML） |
| `packages/server/src/draft-generate.js` | 新增 `editDraftElement`：提取元素 → LLM → 片段后处理（提取/清洗/补 did/续号）→ 定位替换 → 存 v(N+1)，kind=`edit-element` |
| `packages/server/src/http.js` | 新增 `POST /api/draft/:id/edit-element { did, instruction }`；参数缺失 400，元素不存在 404 |
| `packages/shared/src/llm.js` | 新增 `EDIT_ELEMENT_PROMPT_MARKER`；MockProvider 元素编辑模式按指令关键词向根标签注入内联样式（描边/红底/圆角/字号/毛玻璃），保留 data-did，确定性 |
| `packages/editor/public/drafts.html` | 顶栏「点选修改」开关；右栏新增「选中元素」卡片（tag/data-did/文本摘要 + 局部指令输入） |
| `packages/editor/public/drafts-app.js` | 父侧 Inspect：iframe 为 `sandbox="allow-same-origin"`（无 allow-scripts），父窗口直接给 `contentDocument` 挂 mouseover/click 捕获监听；hover 虚线高亮、点选实线高亮；每次 srcdoc load 重挂监听；提交后刷新到最新版本 |
| `packages/editor/public/drafts.css` | 点选按钮 active 态、选中元素卡片样式 |
| `packages/server/test/drafts.test.js` | 新增 5 个测试：扫描器/工具函数、Prompt、Mock 确定性、编辑管线（did 唯一性）、HTTP 集成（400/404/200） |

## 关键设计

- **Inspect 不注入脚本**：草稿 sanitize 已去 `<script>`，iframe 也无 `allow-scripts`；父侧直挂 DOM 监听实现 hover/点选，比 M1 计划的 srcdoc 注入脚本方案更简单、更安全
- **did 稳定性**：替换片段根元素强制保留原 data-did；片段内新增元素按 `maxDataDid+1` 续号，全文 did 不重复（测试断言）
- **定位替换**：正则开标签扫描 + 同名标签 depth 配对找闭合，处理 `<div>` 嵌套 `<div>`；零第三方依赖

## 验证命令与结果

```bash
npm test          # 全部 pass，0 fail（drafts.test.js 15 个）
npm run smoke     # PHASE 1-4 全部 PASS
```

端到端（Mock 模式）：

```
POST /api/draft/generate {"prompt":"做一个落地页"}        → v1
POST /api/draft/:id/edit-element {"did":1,"instruction":"换成描边样式"}
→ {"version":2,"did":"1"}；v2 含 border: 2px solid；kind=edit-element；全文 did 唯一
POST /api/draft/:id/edit-element {"did":9999,...}        → 404 element not found
```

## 结论

PASS。M3「点选局部修改」完成：预览点选元素 → 局部指令 → 只替换该元素 → 新版本落盘。
