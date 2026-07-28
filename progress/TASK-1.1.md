# TASK 1.1 — ProjectSandbox + 内置 preview-server

## 实现
- `packages/server/src/sandbox.js`：`ProjectSandbox`，接口严格按 SPEC 2.2
  （create/writeFile/readFile/listFiles/start/stop/restart/isRunning，端口 listen(0) 自动分配，
  目录穿越防护；存在 node_modules/.bin/vite 时优先真实 vite，否则内置 preview-server）。
- `packages/server/src/preview-server.js`：Node http 预览服务。
  路由：`/`(index 外壳)、`/__runtime.js`、`/__ui.css`、`/__inspect.js`（Phase 2 注入点占位）、
  `/__hmr`(EventSource)、`/components/ui/*.js`、`/src/**`（JSX 即时转译）。
- `packages/server/src/jsx.js`：零依赖 JSX 子集→`h()` 微转译器
  （标签/属性三形态/表达式/自闭合/Fragment/嵌套表达式 JSX；字符串与注释安全跳过；错配标签报错）。
- `packages/server/src/preview-runtime.js`：~100 行浏览器端 `h/render/Fragment` 微型 runtime，
  不依赖真 React；index 外壳注入 HMR-lite（fs.watch → EventSource → reload）与 inspect 注入点注释。
- `packages/server/src/ui-components.js`：registry 组件的内置可渲染实现（/components/ui/*.js）。

## 降级决策
- **不使用 vite/react/esbuild**：离线环境 npm install 不可靠（SPEC 5 预期内）。
  选择「微转译器 + 微型 runtime」路径：完全离线可测，单测不断言底层实现，未来装入真 vite 时
  sandbox.start() 自动切换。影响：JSX 支持为子集（MockProvider 输出已约束在该子集内）。

## 校验
- 命令：`cd packages/server && node --test test/`
- 结果：6/6 PASS
  - create 生成骨架 / writeFile→readFile→listFiles / 目录穿越拒绝
  - start 后 HTTP 取到 index 外壳（含 #root、__inspect.js、__hmr）与转译后 App 模块（h() 调用 + render 引导）
  - writeFile 变更后 HTTP 取到新内容；restart 后再可用；stop 后连接拒绝
  - /components/ui/button.js 200、未知组件 404
  - 转译器单测：属性三形态、Fragment、字符串内 `<` 不误判、mismatched 报错
  - wrapPreviewModule：'@/components/ui/x' 重写、去 export default、注入 runtime import

结论：**PASS**
