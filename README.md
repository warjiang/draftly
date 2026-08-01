# draftly

Draftly 是一个本地运行的 AI 源码原型工具。输入页面需求后，Pi 会在独立工作目录中生成
Vite + React + TypeScript + Tailwind CSS + shadcn/ui 项目。页面通过受控 Vite dev
server 实时预览，并支持整页迭代、源码级点选修改、截图修改、Git 版本回退和源码 ZIP 导出。

生产链路只使用本机已认证的 Pi CLI，不包含 Mock 页面或 HTML 字符串回退。

## 环境要求

- Node.js 20+
- npm 10+
- 已安装并认证的 Pi CLI
- Git

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
# 在 Pi 中完成 /login 后退出
```

## 本地运行

```bash
npm install
npm run dev
```

打开 <http://127.0.0.1:4173>。运行时草稿存放在 `.draftly/drafts/`。

可在根目录 `.env` 中覆盖：

```dotenv
HOST=127.0.0.1
PORT=4173
DRAFTLY_DRAFTS_DIR=.draftly/drafts
DRAFTLY_PI_COMMAND=pi
DRAFTLY_PI_PROVIDER=anthropic
DRAFTLY_PI_MODEL=claude-sonnet-4-20250514
DRAFTLY_PI_THINKING=medium
```

Pi 未安装、未认证、源码任务失败或项目构建失败时，操作会明确失败并恢复任务前的 Git
工作树，不会生成假草稿。

## 源码草稿结构

```text
.draftly/drafts/<draft-id>/
├── meta.json
└── project/
    ├── .git/
    ├── package.json
    ├── components.json
    ├── vite.config.ts
    └── src/
```

每次成功的生成或修改对应一个 Git commit。`meta.json` 保存用户可见版本号与 commit 的
映射。回退不会删除历史，而是恢复目标 commit 的文件树后创建新的 rollback commit。

## 点选修改

草稿模板在 Vite 开发模式中通过 `@locator/babel-jsx` 注入 JSX 源位置。iframe 内的
inspect bridge 负责 hover/click，并通过 `postMessage` 返回源文件、行列、组件名和 DOM
摘要。服务端使用 TSX AST 提取目标 JSX、所属组件和 imports，再让 Pi 在完整项目上下文中
修改真实源码。

该流程不使用 `srcdoc`、`data-did` 或 HTML 字符串替换。

## 旧 HTML 草稿迁移

迁移前建议备份 `.draftly/drafts`，然后执行：

```bash
npm run migrate:drafts
```

命令逐个读取旧草稿的最新 `vN.html`，让 Pi 转换为 React 源码并运行 build。成功后创建独立
Git 仓库，原 HTML 与旧 meta 保存在草稿内的 `legacy-backup/`。迁移幂等；已迁移项会跳过，
单项失败不会阻塞其他草稿，可修复后重试。

## 常用命令

```bash
npm run dev             # 构建编辑器并启动本地服务
npm run build           # 构建编辑器和源码草稿模板
npm test                # 运行全部测试
npm run smoke           # 真实模板/预览/定位/Git/ZIP 冒烟
npm run migrate:drafts  # 迁移旧 HTML 草稿
npm run check           # build + test + smoke
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/drafts/generate` | 生成源码草稿 `{prompt, variants?, style?}` |
| GET | `/api/drafts` | 草稿列表 |
| GET | `/api/drafts/:id` | 草稿 metadata、当前版本和默认入口源码 |
| GET | `/api/drafts/:id/source?file=src/App.tsx` | 读取受限项目源码 |
| POST | `/api/drafts/:id/preview` | 启动/复用 Vite 预览 |
| POST | `/api/drafts/:id/iterate` | 整页源码迭代 `{instruction}` |
| POST | `/api/drafts/:id/edit-source` | 点选修改 `{locator, instruction}` |
| POST | `/api/drafts/:id/edit-by-image` | 截图修改 `{image, instruction}` |
| POST | `/api/drafts/:id/rollback` | 基于旧版本创建回退 commit `{v}` |
| GET | `/api/drafts/:id/versions/:v/diff` | 查看版本 Git diff |
| GET | `/api/drafts/:id/export` | 下载源码 ZIP |
| GET | `/api/templates` | 风格预设列表 |
| GET | `/api/templates/:id` | 风格预设详情 |
| POST | `/api/extract` | 从 `{html, css}` 或 `{url}` 提取设计系统 |

生成、迭代、点选、截图和回退接口可追加 `?stream=1`，以 NDJSON 依次返回 scaffold、依赖
安装、Pi read/edit/write/bash、构建、Git commit 和 preview 等过程事件。

## Monorepo

```text
packages/
├── draft-template/  生成项目的 Vite/React/TS/Tailwind/shadcn 模板与 inspect bridge
├── editor/          Draftly React 编辑器
├── server/          Pi workspace 执行、Git 存储、预览进程、Locator/API/迁移
└── shared/          DESIGN.md 解析与校验
scripts/
└── smoke-draft.mjs  源码草稿全链路冒烟
```

## 安全边界

- 草稿路径、源码读取和导出限制在对应 `project/` 内，并拒绝 symlink 越界。
- Vite dev server 仅绑定 `127.0.0.1`，按草稿懒启动并回收。
- Pi 具有草稿 cwd 下的 `read/edit/write/bash` 工具。cwd 不是操作系统级沙箱；只应在可信的
  本地环境运行 Draftly。
