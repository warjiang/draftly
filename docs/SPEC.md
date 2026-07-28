# SPEC — AI 设计工具（Phase 1–4）

单一事实来源。所有子代理必须严格遵守本文件中的接口契约。

## 0. 全局约定
- 语言/运行时：Node.js 20+，全部 ESM（`"type": "module"`）
- 包管理：npm workspaces（根 package.json 已配置 `packages/*`）
- 测试：`node:test`（内置 runner）+ `node:assert`，零额外测试依赖
- 构建：TypeScript 非必须；**用纯 JS + JSDoc 类型注释**，避免构建链复杂度。编辑器前端除外（Vite 构建）
- Lint：不强制；代码风格保持一致即可
- 所有源码修改（patch）必须用 `recast`，禁止字符串替换破坏格式
- LLM 走 Provider 抽象，无 API key 时用 MockProvider（确定性模板输出），保证离线可测

## 1. Monorepo 结构
```
project/
├── package.json                 # 已有
├── packages/
│   ├── shared/                  # @draftly/shared — 共享类型/常量/DESIGN.md 解析
│   ├── server/                  # @draftly/server — sandbox 管理 + 文件 API + 生成管线 + 提取服务 + 桥接服务
│   ├── editor/                  # @draftly/editor — React 编辑器前端（Vite）
│   └── cli/                     # @draftly/cli — 命令行 init / bridge / sync
└── progress/                    # 每个 Task 的校验日志 TASK-x.y.md
```

## 2. 接口契约

### 2.1 @draftly/shared
```js
// packages/shared/src/design-md.js
parseDesignMd(content: string): { meta: object, body: string }
serializeDesignMd(meta: object, body: string): string
defaultDesignMd(overrides?: object): string   // 生成默认 DESIGN.md 全文

// packages/shared/src/registry.js
// component-registry.json schema:
// { "components": [{ "name": "Button", "import": "@/components/ui/button",
//    "variants": ["default","destructive","outline","secondary","ghost","link"],
//    "props": { "size": ["default","sm","lg","icon"] } }] }
loadRegistry(json: string): Registry
validateRegistry(registry: object): string[]  // 返回错误列表，空=通过

// packages/shared/src/llm.js — LLM Provider 抽象
class LLMProvider { async complete(messages, opts) -> string }
class MockProvider extends LLMProvider  // 确定性模板：登录页/仪表盘/落地页
class OpenAICompatibleProvider extends LLMProvider // 读 env: DRAFTLY_LLM_BASE_URL/DRAFTLY_LLM_API_KEY/DRAFTLY_LLM_MODEL
createProvider(): LLMProvider  // 有 key 用 OpenAI 兼容，否则 Mock
```

### 2.2 @draftly/server
```js
// packages/server/src/sandbox.js
class ProjectSandbox {
  constructor(opts: { rootDir: string, templateDir?: string })
  async create(): Promise<void>          // 生成 Vite+React+Tailwind 项目骨架（不跑 npm install，用预置 minimal 模板：纯 esbuild 预览见注）
  async writeFile(relPath, content): Promise<void>
  async readFile(relPath): Promise<string>
  async listFiles(): Promise<string[]>
  async start(): Promise<{ port: number, url: string }>  // 启动预览服务（见注），自动分配端口
  async stop(): Promise<void>
  async restart(): Promise<{ port: number, url: string }>
  isRunning(): boolean
}
```
**重要实现注**：沙箱环境可能无法 npm install vite/react。因此 sandbox 的「dev server」实现为：
- 优先尝试真实 `vite`（若 node_modules 存在）
- 否则退化到内置 **preview-server**：一个 Node http server，用 `esbuild`（若可用）或内置极简 JSX→JS 转译（自实现或 babel standalone）serve `index.html` + 模块，并注入 HMR-lite（文件变更 → WebSocket/EventSource → iframe reload 或热替换）。
- 对外接口不变；单测只断言接口行为，不断言底层实现。

```js
// packages/server/src/generate.js
buildGenerationPrompt(opts: { userPrompt, registry, designMd }): messages[]
generatePage(opts: { sandbox, provider, userPrompt }): Promise<{ file: string, code: string }>
// 生成代码写入 src/App.jsx，并自动为每个 JSX 元素注入 data-source-loc="file:line:col"（用 babel 插件实现，见 ast.js）

// packages/server/src/ast.js  (recast + @babel/parser/traverse/generator)
parseCode(code: string): AST
serialize(ast): string
injectSourceLoc(code: string, file: string): string        // 编译期注入 data-source-loc
findElementByLoc(ast, loc: string): NodePath | null
patchElementClass(code, loc, newClass): string             // 处理 字符串 / cn() / clsx() 三种
patchElementText(code, loc, newText): string
patchElementStyle(code, loc, styleObj): string

// packages/server/src/extract.js  (Phase 3)
extractDesignSystem(html: string, cssTexts: string[]): { designMd, tokens, tailwindCss }
// 说明：Playwright 抓取作为可选增强；核心算法（颜色聚类 K-means、字体层级、间距 GCD）
// 接收 html/css 字符串输入，保证可用本地 fixture 离线单测。

// packages/server/src/http.js
createApiServer(opts: { sandboxManager, provider }): http.Server
// REST: GET /api/files, GET/PUT /api/file?path=, POST /api/generate {prompt},
//       POST /api/patch {loc, type: 'class'|'text'|'style', value},
//       POST /api/sandbox/start|stop, GET /api/sandbox/status
//       GET /api/design-md, PUT /api/design-md
//       GET /api/templates, POST /api/templates/apply {id}
```

### 2.3 @draftly/editor（React 前端）
- Vite + React 18（用 18 而非 19，降低依赖风险）+ 手写极简 CSS（不强制 shadcn/Tailwind，避免安装风险；样式保持浅色、低饱和、留白充分）
- 布局：左组件面板 / 中 iframe 预览（指向 sandbox url）/ 右属性面板 / 底代码 Tab（只读）
- Inspect 模式：iframe 注入脚本（由 preview-server 自动注入），postMessage 回传选中元素 `{ loc, tagName, className, textContent, computedStyles }`
- Undo/Redo：基于服务端文件快照栈（server 提供 /api/history push/undo/redo）
- 模板库页：/templates 路由或 Tab

### 2.4 @draftly/cli
```js
// packages/cli/src/detect.js
detectProject(dir): { framework: 'react'|'vue'|'next'|'unknown', styling: 'tailwind'|'css-vars'|'mui'|'unknown',
                      componentsDir: string|null, tailwindConfig: object|null, cssVars: object }
generateDesignMdFromDetection(detection): string
// packages/cli/src/bridge.js
startBridge(opts: { target: string, port: number, projectDir: string }): Promise<{ url: string }>
// HTTP 代理转发 target（如 http://localhost:3000），HTML 响应注入 inspect 脚本；
// WebSocket 通道暴露文件读写 API（复用 @draftly/server 的 ast patch 能力）
// packages/cli/src/sync.js
syncDraftToLocal({ draftDir, localDir, strategy: 'overwrite'|'merge'|'patch' }): Promise<SyncReport>
createDraftFromLocal({ localDir, draftDir }): Promise<SyncReport>
compareDraftLocal({ draftDir, localDir }): Promise<{ diffs: Diff[] }>
```

## 3. 校验门槛（每个 Task 必做）
1. 该包 `npm test`（node --test）全绿
2. 根目录 `npm run build`（如适用）通过
3. 校验证据写入 `progress/TASK-<phase>.<task>.md`：包含运行的命令、输出摘要、结论 PASS
4. git commit，message: `feat(phaseN): task 描述`

## 4. 验收标准（对齐原计划）
- Phase 1：mock 模式输入「做一个登录页」→ 生成含组件结构的 App.jsx → iframe 可渲染；编辑器三栏可用；undo/redo 可用
- Phase 2：patchElementClass/Text/Style 单测覆盖三种 className 形态且格式保留（recast output 与原码 diff 仅限目标节点）
- Phase 3：fixture HTML/CSS → DESIGN.md（含 colors/typography/spacing）；10 个预置模板；apply 后 designMd 变更
- Phase 4：fixture React 项目 init 检测正确；bridge 代理注入脚本；三种 sync 策略单测通过

## 5. 已知风险处置
- 无法安装依赖时：每包 deps 最小化；preview-server 自实现；不允许因网络问题停工——用降级实现并在 progress 日志注明。
- /mnt 挂载写入偶有延迟：shell heredoc 写文件后必须 `cat` 验证；优先用 write_file 工具。
