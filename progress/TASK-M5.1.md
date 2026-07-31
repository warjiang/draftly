# TASK M5.1 - 截图驱动修改（edit-by-image）

对应规划：docs/html-draft-plan.md（M5 方向：精准修改的截图路径）

## 背景

用户愿景：支持「通过截图或 inspect html 元素实现精准修改原型设计」。M3 已实现 inspect 点选修改；本任务补齐「截图参考修改」路径。

## 实现内容

| 模块 | 说明 |
| --- | --- |
| `packages/shared/src/llm.js` | `EDIT_BY_IMAGE_PROMPT_MARKER`；`mockHtmlEditByImage` 确定性输出（离线复用迭代关键词修改 + 注入 `m-img-edit` 标记）；`MockProvider.complete` 支持多模态数组 content（提取文本部分）与截图分支 |
| `packages/server/src/draft-prompts.js` | `buildEditByImagePrompt`：多模态 messages（文本 `当前 HTML / 修改指令` + `image_url`） |
| `packages/server/src/draft-generate.js` | `editDraftByImage`：当前 HTML + 截图 + 指令 -> LLM -> 后处理 -> 存 v(N+1)，kind=`edit-by-image` |
| `packages/server/src/http.js` | `POST /api/draft/:id/edit-by-image {image, instruction}`；readBody 上限 5MB -> 10MB 容纳截图 base64 |
| `packages/editor/public/drafts.html` + `drafts-app.js` + `drafts.css` | 右栏「截图修改」区：点击选择 / Ctrl+V 粘贴图片、缩略预览、指令输入、提交 |
| 测试 | shared.test.js 截图 Mock 确定性；drafts.test.js editDraftByImage 单元 + HTTP 端点 |
| `scripts/smoke-draft.mjs` | 新增第 7 步截图修改（1x1 PNG） |

## 真实模型注意

- `OpenAICompatibleProvider` 直接透传 messages（含 `image_url` 数组 content），兼容 OpenAI 多模态接口
- 截图需为 data URL（`data:image/png;base64,...`），前端 `FileReader.readAsDataURL` 生成
- Mock 不解析图片，按指令关键词确定性回退，保证离线可测

## 验证

```bash
npm test          # server 34 + shared 9，全绿（含截图修改 3 个新测试）
npm run build     # editor dist 3 files
npm run smoke     # 10/10 PASS（M1-M5）
npm run check     # build + test + smoke 全绿
```

## 结论

PASS。用户愿景「自然语言生成 + inspect 点选 + 截图参考修改」三条精准修改路径中，inspect（M3）与截图（M5.1）均已实现。
