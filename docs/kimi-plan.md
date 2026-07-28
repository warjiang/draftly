# AI 设计工具 — 执行计划（Orchestrator 蓝图）

来源：用户上传的《AI 设计工具 — 可执行开发计划》
范围：实现 Phase 1–4（不含 Phase 5 MCP，遵循用户此前明确指示「除了最后一步 mcp 之外」）
交付目录：/mnt/agents/output/draftly/（monorepo: packages/editor, packages/server, packages/cli）

## 关键约束（写入每个 coder 任务）
- Node 20+ / pnpm workspace 单仓
- MVP 只支持 React + Tailwind 生成目标
- 源码修改必须用 recast 保留格式
- AI 生成走可插拔 LLM Provider：无 API key 时提供 deterministic mock provider（模板化生成登录页等），保证离线可校验
- 每个 Task 完成 => 跑 build / unit test / 冒烟脚本，全部通过才算 done
- 校验证据（命令 + 输出摘要）写入 progress/ 目录日志

## Stage 划分（Stage-Gate，串行）
- Stage 0: 仓库初始化（monorepo、pnpm workspace、基础 tooling）— coder
  - 校验: pnpm install + 空包 build 通过
- Stage 1: Phase 1 核心骨架（Week1-3）
  - Task 1.1 ProjectSandbox + 端口/进程管理 + 文件 API → 单测校验
  - Task 1.2 组件库预置 + component-registry + AI Prompt 模板 + 生成管线 → 生成代码编译校验
  - Task 1.3 编辑器 UI（组件面板/iframe/属性面板/代码Tab/Undo-Redo）→ build + 冒烟
- Stage 2: Phase 2 Inspect 闭环（Week4-6）
  - Task 2.1 iframe 选择器注入 + postMessage + data-source-loc → 单测/集成校验
  - Task 2.2 recast AST patch（class/text/style 三种）→ 单测（含格式保留断言）
  - Task 2.3 自然语言改元素 → 单测（mock provider）
- Stage 3: Phase 3 设计系统（Week7-9）
  - Task 3.1 DESIGN.md 规范 + 默认生成 + 注入 prompt → 单测
  - Task 3.2 Playwright 设计提取（颜色聚类/字体层级/间距GCD）→ 单测（本地 fixture 页面，避免外网依赖）
  - Task 3.3 模板库 UI + 10 个预置模板 + 一键应用 → build + 校验
- Stage 4: Phase 4 CLI 桥接（Week10-12）
  - Task 4.1 CLI init 项目检测 → 单测（fixture 项目）
  - Task 4.2 桥接服务（HTTP 代理注入脚本 + WS + 文件 API）→ 集成测试
  - Task 4.3 双向同步（sync_draft_to_local / create_draft_from_local / compare_draft_local）→ 单测
- Stage 5: 总集成 + 端到端冒烟 + README/使用文档 + 最终报告

## 子代理策略
- 每个 Stage 用 foreground coder 子代理，prompt 含：guidance（上方约束）+ context（上游产物路径）+ mission（具体 task + 校验命令）
- 每个 Stage 结束后由 reviewer/verifier 子代理独立复核校验证据，Fail 则回炉
- skill: vibecoding-general-swarm（编码编排规范）
