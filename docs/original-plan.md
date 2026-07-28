# 🎨 AI 设计工具 — 可执行开发计划

## 项目定位
面向非专业设计人群的在线原型设计工具。底层生成 Vite+React+Tailwind 代码，支持自然语言/截图/Inspect 编辑，
通过 DESIGN.md 保证设计一致性，CLI 桥接已有项目，MCP 协议接入 Coding Agent 工作流。

---

## 技术栈总览

| 层级 | 选型 | 说明 |
|------|------|------|
| 前端编辑器 | React 19 + Tailwind + shadcn/ui | 编辑器本身也用 shadcn，保持一致 |
| 预览渲染 | Vite 6 + React 19 + iframe | 每个项目独立 Vite 进程，HMR 实时刷新 |
| 组件库 | shadcn/ui + Radix UI | AI 生成的事实标准，扩展 Magic UI/Aceternity |
| 样式 | Tailwind CSS v4 | AI 生成质量最高，用户熟悉度最高 |
| 设计契约 | DESIGN.md (YAML front matter + Markdown) | 机器可读、版本可控 |
| 文件操作 | Node fs + recast (AST) | 保留代码格式，精准修改 |
| AI 模型 | Claude 3.5 Sonnet / GPT-4o | 代码生成 + 视觉理解 |
| 后端框架 | Fastify / Hono | 轻量，方便管理多 Vite 子进程 |
| 页面渲染 | Playwright + Chromium | 设计系统提取、截图识别 |
| CLI | Commander.js + Ink | 交互式终端，本地桥接 |
| MCP | @modelcontextprotocol/sdk | stdio + Streamable HTTP 双模式 |

---

## Phase 1：核心骨架 — 远程 Vite 沙箱 + AI 生成页面

**目标**：用户输入一句话，5 秒内看到生成的页面在 iframe 中渲染。

### Week 1：Vite 项目沙箱
- [ ] 实现 `ProjectSandbox` 类：动态创建 Vite 项目目录、安装依赖、启动 dev server
- [ ] 端口自动分配 + 进程生命周期管理（启动/停止/重启）
- [ ] iframe 加载远程 Vite 页面，CORS 和 HMR 配置正确
- [ ] 基础文件 API：读取/写入项目文件

**验证**：浏览器打开编辑器，iframe 能正常显示 Vite 欢迎页，修改文件后 HMR 自动刷新。

### Week 2：组件库预置 + AI 生成
- [ ] 项目初始化时自动安装 shadcn/ui（button, card, input, dialog, tabs 等 20 个基础组件）
- [ ] 维护 `component-registry.json`，记录可用组件名称、路径、变体
- [ ] 设计 AI Prompt 模板：注入组件库索引 + 基础约束 → 输出 React + Tailwind 代码
- [ ] 自然语言生成页面：用户输入 → AI 生成代码 → 写入文件 → iframe HMR 刷新

**验证**：输入「做一个登录页」，5 秒内 iframe 显示包含 shadcn/ui 组件的登录页面。

### Week 3：基础编辑器 UI
- [ ] 左侧：组件库面板（拖拽放置基础组件到画布）
- [ ] 中间：iframe 预览区（加载远程 Vite）
- [ ] 右侧：属性面板（修改文案、颜色、字号）
- [ ] 底部：代码查看 Tab（只读，展示当前页面源码）
- [ ] 历史栈：Undo/Redo（基于文件快照）

**验证**：能从左侧拖拽 Button 到页面，右侧修改文字后 iframe 实时更新。

---

## Phase 2：Inspect 编辑闭环 — 点选即改

**目标**：用户在 iframe 中点击任意元素，右侧面板显示属性，修改后 AST 精准改源码，HMR 刷新。

### Week 4：Inspect 选择器
- [ ] iframe 内注入选择器脚本（hover 高亮 + click 选中）
- [ ] postMessage 通信：选中元素信息回传父窗口
- [ ] 元素路径生成：`data-source-loc` 编译时注入（AI 生成代码时自动添加）
- [ ] 右侧面板展示：tagName、className、textContent、computed styles

**验证**：点击 iframe 中的按钮，右侧面板正确显示该按钮的所有属性。

### Week 5：AST 精准修改
- [ ] 集成 recast（保留代码格式）+ @babel/traverse
- [ ] 实现 `patchElementClass`：修改 className（字符串 / cn() / clsx() 三种情况）
- [ ] 实现 `patchElementText`：修改文本内容
- [ ] 实现 `patchElementStyle`：添加/修改内联样式
- [ ] 修改后写入文件，Vite HMR 自动刷新 iframe

**验证**：右侧面板把按钮颜色从 blue 改成 red，iframe 实时刷新，源码精准修改且格式不乱。

### Week 6：自然语言改元素
- [ ] 选中元素后，输入自然语言指令（如「字体调大、改成圆角」）
- [ ] AI 解析指令 → 生成修改后的 className → AST 应用 → HMR 刷新
- [ ] 指令上下文：当前元素代码 + DESIGN.md + 用户指令

**验证**：选中标题，输入「改成 36px 的紫色渐变标题」，iframe 实时更新。

---

## Phase 3：设计系统层 — DESIGN.md + 模板库

**目标**：建立设计契约，支持从任意网站提取设计系统并复用。

### Week 7：DESIGN.md 规范与生成
- [ ] 定义 DESIGN.md 标准格式（YAML front matter + Markdown）
- [ ] 包含：Colors、Typography、Spacing、Radius、Shadows、Motion、Components、反模式
- [ ] 项目初始化时自动生成默认 DESIGN.md
- [ ] AI 生成代码时强制读取项目 DESIGN.md 作为 system prompt 的一部分

**验证**：同一 prompt 在两个不同 DESIGN.md 的项目中生成不同配色的页面。

### Week 8：网站设计系统提取
- [ ] Playwright 渲染目标网站，提取 computed styles
- [ ] 颜色聚类（K-means）、字体层级分析、间距基数推断（GCD）
- [ ] 生成 DESIGN.md + tokens.json + tailwind.css
- [ ] 模板库数据模型：来源 URL、截图、标签、置信度评分

**验证**：输入 https://linear.app，10 秒内生成 Linear 风格的 DESIGN.md。

### Week 9：模板库 UI
- [ ] 模板列表页：卡片展示（截图 + 名称 + 标签 + 评分）
- [ ] 搜索/筛选：按风格、行业、颜色筛选
- [ ] 一键应用：选择模板 → 写入项目 DESIGN.md → 重新生成页面
- [ ] 预置 10 个热门模板（Linear、Stripe、Notion、Vercel 等）

**验证**：选择「Stripe 风格」模板后，新生成的页面自动使用 Stripe 的配色和字体。

---

## Phase 4：CLI 桥接 — 已有项目接入

**目标**：用户在已有项目根目录运行 CLI，将设计工具接入本地 dev server。

### Week 10：CLI 项目检测
- [ ] `npx your-design-cli init`：检测框架（React/Vue/Next）、样式方案（Tailwind/MUI）
- [ ] 扫描组件目录、提取 tailwind.config、CSS 变量
- [ ] 生成 DESIGN.md + component-registry.json

**验证**：在任意 React 项目运行 init，正确识别技术栈并生成 DESIGN.md。

### Week 11：桥接服务
- [ ] 本地 HTTP 代理：转发用户 dev server 请求，注入 Inspect 脚本
- [ ] WebSocket 通道：编辑器 ↔ 桥接服务 ↔ 本地项目文件系统
- [ ] 文件 API：REST + WS 双通道读写项目文件
- [ ] 源码映射：data-source-loc 或 Source Map 反查

**验证**：运行 `npx your-design-cli bridge --target http://localhost:3000`，Web 编辑器 iframe 加载本地项目并支持 Inspect。

### Week 12：双向同步
- [ ] `sync_draft_to_local`：草稿 → 本地代码（overwrite/merge/patch 三种策略）
- [ ] `create_draft_from_local`：本地代码 → 草稿（反向同步）
- [ ] `compare_draft_local`：检测本地代码偏离草稿规范
- [ ] merge 策略：保留本地业务逻辑，同步 UI 结构和样式

**验证**：在编辑器修改草稿后，本地项目文件自动更新，dev server HMR 刷新。

---

## Phase 5：MCP 协议层 — AI Agent 集成

**目标**：Coding Agent（Claude Code / Cursor）通过 MCP 将草稿作为 Single Source of Truth。

### Week 13：MCP Server 基础
- [ ] 基于 `@modelcontextprotocol/sdk` 实现 stdio 传输
- [ ] Tools：list_drafts、get_draft_spec、get_draft_tokens、get_component_code
- [ ] Resources：draft://{id}/design.md、draft://{id}/tokens
- [ ] 本地运行：`npx your-design-cli mcp`

**验证**：Claude Code 安装 MCP 后，能读取草稿的 DESIGN.md 和组件树。

### Week 14：MCP 编辑与同步
- [ ] Tool：edit_draft（自然语言修改草稿）
- [ ] Tool：sync_draft_to_local（草稿 → 本地代码）
- [ ] Tool：compare_draft_local（检测偏离）
- [ ] Prompt：before-coding-ui（强制 Agent 先读规范再写代码）

**验证**：用户告诉 Claude「给登录页加记住我」，Claude 先调用 edit_draft 改草稿，再 sync 到本地，不直接改本地文件。

### Week 15：Remote HTTP + 团队部署
- [ ] Streamable HTTP 传输模式
- [ ] OAuth 认证 + 项目权限管理
- [ ] MCP Gateway 层（审计日志、速率限制）
- [ ] 文档：Claude Code / Cursor / Windsurf 配置指南

**验证**：团队成员通过远程 MCP endpoint 接入，共享同一套草稿规范。

---

## 里程碑与验收标准

| 里程碑 | 时间 | 验收标准 |
|--------|------|---------|
| **MVP 可用** | Week 6 | 自然语言生成页面 + Inspect 点选编辑 + HMR 实时刷新 |
| **设计系统闭环** | Week 9 | 支持从任意网站提取 DESIGN.md + 模板库一键套用 |
| **本地项目接入** | Week 12 | CLI 桥接已有项目，双向同步，检测偏离 |
| **Agent 集成** | Week 15 | MCP Server 接入 Claude Code/Cursor，实现 Single Source of Truth |

---

## 开发原则

1. **MVP 优先**：每个 Phase 先跑通主路径，再优化边缘 case
2. **React 优先**：MVP 只支持 React + Tailwind，Vue 后续扩展
3. **AI 约束生成**：限制组件库和 token，避免 AI 自由发挥导致风格漂移
4. **格式保留**：所有源码修改用 recast，绝不破坏用户代码格式
5. **HMR 即真理**：任何修改必须走 Vite HMR，拒绝整页刷新

---

## 风险与应对

| 风险 | 应对 |
|------|------|
| AI 生成布局不稳定 | 限制组件库，用 JSON Schema 约束输出结构 |
| AST 修改破坏代码 | 用 recast 保留格式，修改前做文件备份 |
| 桥接后 HMR 失效 | 严格测试 WebSocket 代理转发，重写 HMR 路径 |
| 截图识别精度低 | 不做像素级复刻，做语义级组件匹配 |
| MCP 生态变化快 | 紧跟 @modelcontextprotocol/sdk 官方更新 |

---

## 立即开始（Today）

1. **初始化仓库**：monorepo 结构（packages/editor, packages/server, packages/cli, packages/mcp）
2. **Week 1 任务拆分**：ProjectSandbox 类 + Vite 进程管理
3. **准备 Prompt 模板**：基础 AI 生成 Prompt（组件库索引 + Tailwind 约束）
4. **搭建开发环境**：Node 20+, pnpm workspace, Tailwind v4, shadcn/ui
