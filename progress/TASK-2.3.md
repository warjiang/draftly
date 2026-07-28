# TASK-2.3 — Week6 自然语言改元素

## 实现
- `packages/server/src/nl-edit.js`（新增）：
  - `buildEditPrompt({ elementCode, designMd, instruction })`：system 含 EDIT_PROMPT_MARKER、
    输出契约（json 围栏 `{"class"?, "text"?, "style"?}`）、DESIGN.md 摘要、目标元素代码。
  - `parseEditOutput(raw)`：json 围栏 / 裸 JSON / 裸 class 字符串三种输出归一为 edit 对象。
  - `extractElementCode(code, loc)`：开标签起 ~5 行上下文。
  - `editElement({ sandbox, provider, loc, instruction, history? })`：读文件 → prompt → LLM/Mock
    → ast patch（class→text→style 顺序）→ 写文件 → history 快照；无变更返回 unchanged 且不入栈。
- `packages/shared/src/llm.js`：MockProvider 增加确定性编辑能力。`MOCK_EDIT_RULES` 关键词表：
  36px→text-4xl、字体调大→text-2xl、调小→text-sm、紫色渐变→bg-gradient-to-r from-purple-500
  to-fuchsia-500 bg-clip-text text-transparent、渐变→teal/cyan、圆角→rounded-xl、全圆角→rounded-full、
  背景红→bg-red-500、红色→text-red-500（suppressIf 防与背景红重复）、加粗→font-bold。
  编辑模式优先于页面模板路由（元素代码可能含「登录」等词）。输出 ```json 围栏，确定性。
- `http.js`：`POST /api/nl-edit {loc, instruction}` → 200 {ok, file, content, edit, applied}
  / 400 参数缺失 / 422 loc 无效等 patch 错误。
- 编辑器：属性面板顶部指令输入框（Enter 或按钮提交）→ /api/nl-edit → iframe HMR-lite 刷新 +
  history 按钮刷新；`styles.css` 复用现有 field 风格（浅色低饱和，无渐变）。

## 校验
- `node --test packages/server/test/nl-edit.test.js`（新增 7 项）：Mock 确定性（同输入同输出）、
  关键词表、prompt 结构、parseEditOutput 三形态、端到端（生成登录页→h2 loc→
  「改成 36px 紫色渐变标题」→文件含 text-4xl + 紫色渐变 class→undo 还原→redo 恢复）、
  无匹配指令 unchanged 不入 history、/api/nl-edit 端点（200/400/422 + undo 生效）——全绿。
- `npm test`：editor 3/3、server 50/50、shared 7/7 全绿（Phase 1 测试未破坏）。
- `node scripts/smoke-phase2.mjs`：PASS，集成 nl-edit 全流程（含 preview 模块反映变更、undo 还原）。
- `node scripts/smoke-phase1.mjs`：PASS（基线回归）。

## 降级/说明
- 离线无真实 LLM：MockProvider 关键词映射完全确定性；接入真实 LLM 时走同一 buildEditPrompt/
  parseEditOutput 管道，无需改 server/editor。
- 结论：PASS
