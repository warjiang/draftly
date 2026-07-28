# draftly 重规划 — 基于 HTML 的 AI 设计草稿

## 1. 问题诊断（为什么现在"完全不对"）

| 现状 | 问题 |
| --- | --- |
| 产物是 `src/App.jsx`，限制在自实现的 JSX 安全子集 | 真实 LLM 输出稍复杂就转译失败；模型视觉能力被组件注册表束缚 |
| 预览链路：JSX → 自写转译器 → preview-server → iframe | 链路长、易碎，为"离线 Mock 可测"过度设计 |
| 编辑走 AST patch（class/text/style 三种） | 只能改属性，改不了布局/结构，离"画草稿"很远 |
| 交互模型是"代码编辑器"（组件面板/代码 Tab） | 用户要的是"设计工具"：出方案、看效果、说话改 |

**核心转变：产物从 React 代码 → 单文件 HTML 草稿（HTML + 内联 CSS/Tailwind CDN），iframe `srcdoc` 直接渲染，零转译。**

## 2. 目标产品形态

```
用户输入一句话（"做一个 SaaS 定价页，深色，科技感"）
   ↓
AI 生成 1~3 个 HTML 草稿变体（完整可渲染的单文件 HTML）
   ↓
画布区并排预览缩略图 → 点开某个方案全屏预览
   ↓
迭代方式：
  a) 对话式整页迭代："导航栏改成毛玻璃"
  b) 点选元素局部修改："这个按钮换成描边样式"
   ↓
版本历史（每次生成/修改一个快照，可回退）
   ↓
导出：下载 HTML / 复制源码 /（后续）转 React 组件
```

## 3. 技术方案

### 3.1 草稿产物

- 每个草稿 = 一个自包含 HTML 文件，存 `.draftly/drafts/<draftId>/v<N>.html`
- 元信息 `.draftly/drafts/<draftId>/meta.json`：`{ id, title, prompt, createdAt, versions: [...] }`
- HTML 约定（由 system prompt 保证 + 服务端后处理兜底）：
  - 完整文档：`<!doctype html>` + `<style>` 内联（或 Tailwind CDN，二选一，可配置）
  - 服务端注入：给每个可见元素加 `data-did="<自增id>"`（inspect 定位用，替代原 `data-source-loc`）
  - 禁止外链 JS；图片用占位（`https://placehold.co` 或内联 SVG）

### 3.2 生成管线（server）

```
POST /api/draft/generate   { prompt, variants?: 1-3, designMd?: bool }
  → 并行调用 LLM（variants 次，temperature 略拉开）
  → 提取 ```html 围栏 / 或整段输出即 HTML
  → sanitize（去 <script>）+ 注入 data-did
  → 落盘 v1，返回 { draftId, versions:[{v, html}] }

POST /api/draft/:id/iterate  { instruction }
  → prompt = 当前 HTML 全文 + 修改指令 → 模型输出新整页 HTML → 存 v(N+1)

POST /api/draft/:id/edit-element  { did, instruction }
  → prompt = 元素 outerHTML + 上下文片段 + 指令 → 模型只输出替换后的元素 HTML
  → 服务端按 data-did 定位替换 → 存 v(N+1)

GET  /api/drafts            草稿列表
GET  /api/draft/:id?v=N     取某版本 HTML
POST /api/draft/:id/rollback {v}
GET  /api/draft/:id/export  下载 HTML
```

Prompt 要点：
- system：角色 = 资深 UI 设计师；输出完整 HTML；现代设计规范（间距体系、字阶、配色和谐、hover 态）；`DESIGN.md` 存在时注入为设计契约
- edit-element 模式：只返回目标元素的 outerHTML，禁止改动 `data-did`

### 3.3 预览

- iframe `srcdoc`（加 `sandbox="allow-same-origin"`），**彻底删掉 JSX 转译 + preview-server 代理链路**
- 缩略图：iframe 缩放（`transform: scale(0.25)`）实现，不需要截图服务
- Inspect：向 srcdoc 注入一段脚本（复用现有 `shared/inspect.js` 的 postMessage 协议），hover 高亮 + 点选回传 `{ did, tagName, outerHTML 摘要 }`

### 3.4 编辑器 UI 改造

```
┌────────────────────────────────────────────────┐
│ 顶栏：draftly · 新建草稿 · 版本切换 · 导出       │
├──────────┬─────────────────────────┬───────────┤
│ 草稿列表  │   预览画布              │ 对话/修改  │
│ (缩略图)  │   单个大预览 or         │ - 迭代输入 │
│          │   多变体并排对比         │ - 选中元素 │
│          │                         │   局部指令 │
│          │                         │ - 版本历史 │
└──────────┴─────────────────────────┴───────────┘
```

- 左栏：草稿卡片（缩略图 + 标题），替代原"组件面板"
- 中间：预览画布；生成多变体时并排对比，点选定为当前方案
- 右栏：对话式迭代输入框 + 选中元素信息 + 版本历史列表（点击回退）
- 移除：组件拖拽、代码 patch 属性表单（保留只读"查看源码"）

## 4. 保留 / 删除 / 新增

| 处置 | 模块 |
| --- | --- |
| 保留 | `http.js` 服务骨架、`history.js`（思想复用为版本快照）、`design-md.js`、`llm.js` Provider、`.env` 加载 |
| 保留（降级为可选） | `templates.js` 模板库 → 转为"设计风格预设"注入 prompt |
| 删除/冻结 | `jsx.js` 转译器、`ast.js` JSX patch、`preview-server.js`/`preview-runtime.js`、`sandbox.js` Vite 逻辑、组件注册表驱动的 `insert` |
| 新增 | `drafts.js`（草稿存储/版本）、`html-post.js`（sanitize + data-did 注入 + 围栏提取）、`draft-prompts.js`、编辑器新 UI |
| Mock | MockProvider 增加确定性 HTML 模板输出（登录页/落地页），保持离线可测 |

## 5. 里程碑

- **M1 生成即所见（1~2 天）**：`/api/draft/generate` + srcdoc 预览 + 草稿落盘。验收：真实模型下输入一句话 → 3 秒级出可看的 HTML 草稿
- **M2 对话迭代 + 版本（1 天）**：iterate 接口 + 版本历史/回退 + 新三栏 UI
- **M3 点选局部修改（1~2 天）**：inspect 注入 + edit-element 接口 + 选中态 UI
- **M4 多变体与风格（1 天）**：并行多变体、风格预设（原模板库改造）、导出 HTML
- **M5（后续）**：HTML → React/JSX 转换导出、截图分享、DESIGN.md 反向提取（复用 extract.js）

## 6. 风险与对策

- 模型输出不含围栏/夹杂说明文字 → 服务端提取器容错（找 `<!doctype` / `<html` 起点）
- 整页迭代 token 消耗大 → 页面超阈值时提示用局部修改；后续可做分区段迭代
- srcdoc 中 Tailwind CDN 需联网 → 默认走内联 `<style>`；Tailwind 模式作为可选项
