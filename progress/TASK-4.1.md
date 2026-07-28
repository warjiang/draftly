# TASK-4.1 校验日志 — CLI 项目检测（Week10）

## 实现
- **新包** `packages/cli`（@draftly/cli，bin `draftly` → `src/index.js`，零依赖，全 ESM）。
- `src/detect.js`（SPEC 2.4 契约）：
  - `detectProject(dir)`：package.json deps/devDeps 判 framework（next > react > vue，next 优先因 next 项目必含 react）；styling 判定顺序 tailwind.config.* → @mui/* → src 下 css 的 :root 变量；componentsDir 探测 `src/components`→`components`→`app/components`；递归扫描组件文件（.jsx/.tsx/.vue/.svelte/.js/.ts，跳过 node_modules/隐藏目录）。
  - `parseTailwindColors`：正则定位 `theme.extend.colors`，括号/引号感知截取，顶层 key 解析（`primary: '#hex'` 与嵌套 `accent: { 500: '#hex' }` → 拍平 `accent-500`）。
  - `extractCssVars`：`:root { --name: value }` 变量表。
  - `generateDesignMdFromDetection`：色值池优先级 tailwind colors → cssVars(hex) → 默认值，字体取 `--font-family/--font-sans`；产物过 `validateDesignMd`。
  - `generateRegistryFromDetection`：组件文件（大写开头）→ `{ name, import: "@/..." }`，过 `validateRegistry`。
- `src/index.js`：`node:util parseArgs` 手写参数解析（离线无 commander）；`draftly init [--dir] [--dry-run]`；bridge/sync 子命令入口 + 帮助文本（实现见 Task 4.2/4.3）。
- fixture：`test/fixtures/react-tailwind-app/`（react+tailwind deps、tailwind.config.js 含嵌套 colors、src/index.css 含 :root 变量、src/components/Button.jsx）。

## 校验命令与结果
```
node --test packages/cli/test/   # 12/12 pass（detect 9 + cli-init 3）
npm test                          # 91/91 pass（cli 13, editor 4, server 65, shared 9）
node scripts/smoke-phase1.mjs / 2 / 3   # PASS / PASS / PASS
```
覆盖点：fixture 检测 framework=react/styling=tailwind、tailwind 嵌套 colors 拍平、CSS 变量提取、生成 DESIGN.md 过 validateDesignMd（含检测色值 #3b6ea5 与 Inter 字体）、registry 过 validateRegistry、vue/css-vars 与 next/mui 检测分支、CLI init 端到端（tmp 目录 init → DESIGN.md/component-registry.json 落盘且合法）、--dry-run 不落盘、帮助文本。

## 备注
- /mnt 写入延迟：曾出现测试读到旧文件的一次性失败，重跑即绿（已确认非代码问题）。
