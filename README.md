# draftly

draftly 是一个可离线运行的 AI 原型设计工具。用一句话描述你想要的页面，AI 生成 1~3 个单文件 HTML 设计草稿，iframe 实时预览，支持对话式整页迭代、点选元素局部修改、截图参考修改、版本历史回退与 HTML 导出。

未配置模型时自动使用确定性 Mock Provider，克隆后可直接运行。

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本

项目无第三方运行时依赖。

## 本地运行

```bash
npm install
npm run dev
```

打开 <http://127.0.0.1:4173>。草稿落盘在 `.draftly/drafts/`（运行时生成，不提交到 Git）。

如需修改端口或草稿目录：

```bash
PORT=4300 DRAFTLY_DRAFTS_DIR=/tmp/draftly-drafts npm run dev
```

## 接入 OpenAI 兼容模型

默认 Mock Provider 可演示完整流程。调用真实模型：

```bash
export DRAFTLY_LLM_BASE_URL="https://your-provider.example/v1"
export DRAFTLY_LLM_API_KEY="your-api-key"
export DRAFTLY_LLM_MODEL="gpt-4o-mini" # 可选
npm run dev
```

或写入项目根目录的 `.env`（已 gitignore）：

```dotenv
DRAFTLY_LLM_BASE_URL=https://your-provider.example/v1
DRAFTLY_LLM_API_KEY=your-api-key
DRAFTLY_LLM_MODEL=gpt-4o-mini
```

启动时自动加载 `.env`，未配置时回退到 Mock Provider。

## 功能

- **生成即所见**：一句话 -> 1~3 个 HTML 草稿变体，iframe `srcdoc` 直接渲染，零转译
- **对话迭代**：自然语言整页修改（如「导航栏改成毛玻璃」）
- **点选修改**：在预览中点选任意元素，针对单个元素下指令（如「换成描边样式」）
- **截图修改**：粘贴/上传参考截图 + 指令，照着截图改当前草稿（多模态，真实模型看图；Mock 下按指令确定性回退）
- **版本历史**：每次生成/修改落盘一个版本，可回退
- **风格预设**：基于模板库的设计契约（DESIGN.md）驱动生成
- **导出 HTML**：下载最新版本整页 HTML

## 常用命令

```bash
npm run dev       # 启动编辑器和 API 服务
npm run build     # 构建编辑器静态资源（拷贝 public -> dist）
npm test          # 运行全部单元测试
npm run smoke     # 运行端到端冒烟测试（draft 模式 M1-M4）
npm run check     # build + test + smoke
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/draft/generate` | 生成草稿 `{prompt, variants?, style?}` |
| GET | `/api/drafts` | 草稿列表 |
| GET | `/api/draft/:id?v=N` | 取某版本 HTML |
| POST | `/api/draft/:id/iterate` | 整页迭代 `{instruction}` |
| POST | `/api/draft/:id/edit-element` | 点选修改 `{did, instruction}` |
| POST | `/api/draft/:id/edit-by-image` | 截图修改 `{image, instruction}` |
| POST | `/api/draft/:id/rollback` | 回退 `{v}` |
| GET | `/api/draft/:id/export` | 下载 HTML |
| GET | `/api/templates` | 风格预设列表 |
| GET | `/api/templates/:id` | 预设详情 |
| POST | `/api/extract` | 设计系统反向提取 `{html, css}` |

## Monorepo 结构

```text
packages/
├── editor/   草稿编辑器 SPA（生成/预览/点选/迭代/版本/导出）
├── server/   API、草稿存储与版本、生成管线、模板库、设计提取
└── shared/   DESIGN.md 工具与 LLM Provider
scripts/      端到端冒烟脚本
docs/         设计草稿规划
progress/     里程碑实现记录（M1-M4）
```

## 文档

- [`docs/html-draft-plan.md`](docs/html-draft-plan.md)：HTML 草稿设计规划
- [`progress/`](progress/)：M1-M4 里程碑验证记录

## 已知限制

- Mock Provider 仅覆盖登录/仪表盘/落地页等确定性模板；真实模型下效果更完整
- 模板配色为人工策展数据，不代表实时抓取结果
- `srcdoc` 中 Tailwind CDN 需联网；默认走内联 `<style>`
