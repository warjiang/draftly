# draftly

draftly 是一个可离线运行的 AI 原型编辑器。它支持自然语言生成页面、iframe 实时预览、Inspect 点选编辑、`DESIGN.md` 设计契约、模板应用，以及将现有 React 项目接入编辑器的 CLI 工作流。

当前实现覆盖原计划的 Phase 1-4。Phase 5 MCP 尚未实现。

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本

项目当前没有第三方运行时依赖。未配置模型时会自动使用确定性 Mock Provider，因此克隆后可直接运行。

## 本地运行

```bash
npm install
npm run dev
```

打开 <http://127.0.0.1:4173>。

首次访问预览区时，draftly 会在 `.draftly/sandbox` 创建本地沙箱。该目录只保存运行时生成内容，不会提交到 Git。

如需修改端口或沙箱路径：

```bash
PORT=4300 DRAFTLY_SANDBOX_DIR=/tmp/draftly-sandbox npm run dev
```

## 接入 OpenAI 兼容模型

默认 Mock Provider 可以演示完整流程。若要调用真实模型，请设置：

```bash
export DRAFTLY_LLM_BASE_URL="https://your-provider.example/v1"
export DRAFTLY_LLM_API_KEY="your-api-key"
export DRAFTLY_LLM_MODEL="gpt-4o-mini" # 可选
npm run dev
```

或者把配置写入项目根目录的 `.env`（已 gitignore）：

```dotenv
DRAFTLY_LLM_BASE_URL=https://your-provider.example/v1
DRAFTLY_LLM_API_KEY=your-api-key
DRAFTLY_LLM_MODEL=gpt-4o-mini
```

启动时会自动加载 `.env`，未配置时仍回退到 Mock Provider。

## 设计草稿（M1，新）

打开 <http://127.0.0.1:4173/drafts.html>：输入一句话描述 → 生成 1~3 个单文件 HTML 设计草稿，
iframe `srcdoc` 直接渲染（不走 JSX 转译），草稿与版本落盘在 `.draftly/drafts/`。

```bash
curl -X POST http://127.0.0.1:4173/api/draft/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"做一个深色科技感的 SaaS 定价页","variants":3}'
```

规划详见 [`docs/html-draft-plan.md`](docs/html-draft-plan.md)。旧版 React 原型编辑器仍在 <http://127.0.0.1:4173/>。

## 常用命令

```bash
npm run dev       # 启动编辑器和 API 服务
npm run build     # 构建编辑器静态资源
npm test          # 运行全部单元测试
npm run smoke     # 运行 Phase 1-4 端到端冒烟测试
npm run check     # build + test + smoke
```

## Monorepo 结构

```text
packages/
├── editor/   原生 ESM 编辑器 SPA、组件面板、预览、Inspect、属性与代码面板
├── server/   API、沙箱、预览服务、源码 patch、历史、设计提取与模板库
├── shared/   DESIGN.md、组件注册表、Inspect 协议与 LLM Provider
└── cli/      项目检测、bridge 代理以及草稿/本地双向同步
scripts/      Phase 1-4 端到端冒烟脚本
docs/         原始需求、Kimi 计划与规格说明
progress/     各阶段任务实现与验证记录
```

## CLI

安装依赖后，可以通过 workspace bin 运行 CLI：

```bash
npm exec -- draftly init --dir /path/to/react-app
npm exec -- draftly bridge --target http://localhost:3000 --port 4600 --dir /path/to/react-app
npm exec -- draftly sync --to-local --strategy merge --local /path/to/react-app
```

也可以直接执行 `node packages/cli/src/index.js`。

CLI 支持：

- `init`：识别 React、Vue、Next.js 和样式方案，生成 `DESIGN.md` 与组件注册表
- `bridge`：代理已有 dev server，注入 Inspect 脚本并开放受限文件 API
- `sync`：使用 `overwrite`、`merge` 或 `patch` 策略同步草稿与本地项目

## 实现说明

为保证离线可运行，当前版本使用以下降级方案：

| 原计划 | 当前实现 |
| --- | --- |
| Vite dev server | 检测到沙箱 Vite 时使用 Vite，否则使用内置 preview server |
| recast / Babel | 使用括号和引号感知的源码扫描器，保留未修改区域格式 |
| Playwright 抓取 | 核心提取算法接收 HTML/CSS；URL 抓取作为可选增强 |
| WebSocket bridge | 使用 SSE reload 通道兜底 |
| 真实 LLM | 默认 Mock Provider，可切换 OpenAI 兼容接口 |

## 文档

- [`docs/original-plan.md`](docs/original-plan.md)：原始开发计划
- [`docs/kimi-plan.md`](docs/kimi-plan.md)：Kimi 的执行计划
- [`docs/SPEC.md`](docs/SPEC.md)：实现规格
- [`progress/`](progress/)：分阶段验证记录

## 已知限制

- JSX 转译器只支持安全子集；复杂动态 `className` 会明确报错
- 模板配色为人工策展数据，不代表实时抓取结果
- `sync` 不删除仅存在于本地的文件
- Phase 5 MCP Server 尚未实现
