# TASK 1.3 — 编辑器 UI + HTTP API 层 + 历史栈

## 实现
- `packages/server/src/history.js`：FileHistory（write/mutate 前快照入 undo 栈；undo 写回旧内容
  （新建文件撤销=删除）；redo；新写入清空 redo 栈）。
- `packages/server/src/sandbox-manager.js`：单 sandbox 生命周期（ensureCreated/ensureStarted/history）。
- `packages/server/src/http.js`：createApiServer，端点按 SPEC 2.2：
  `/api/files`、`/api/file`(GET/PUT)、`/api/generate`、`/api/patch`(class|text|style)、
  `/api/sandbox/start|stop|status`、`/api/design-md`(GET/PUT)、`/api/templates`(空)、
  `/api/templates/apply`(501 占位)；扩展：`/api/history|undo|redo`、`/api/registry`、
  `/api/insert`（拖拽落地）；`/preview/*` 同源代理到 sandbox preview-server（含 SSE 透传）；
  `/` serve 编辑器静态 SPA。
- `packages/editor/public/`：无构建 SPA（原生 ES module，index.html/app.js/styles.css）。
  三栏布局：左组件面板（registry 列表，HTML5 拖拽 → iframe drop → /api/insert；点击看属性）、
  中 iframe(src=/preview/) + 底部代码 Tab（GET /api/file 只读）、右属性面板
  （点击 iframe 元素 → data-source-loc → 编辑文本/颜色/字号 → /api/patch 写回）；
  顶栏生成框 + Undo/Redo 按钮（调 /api/history/*，操作后刷新 iframe）。

## 降级决策
1. **编辑器不做 Vite 构建**（离线 npm install 不可靠）：无构建 SPA，server 直接 serve public/；
   `npm run build` 退化为拷贝 public→dist（脚本 packages/editor/scripts/build.js，保留未来换
   Vite 的契约）。影响：无 JSX/TS 开发体验，Phase 1 UI 逻辑量小可接受。
2. **inspect 简化版**：/preview/ 同源代理使编辑器可直接挂 iframe click 监听读 data-source-loc，
   无需注入脚本；跨域 inspect 注入脚本留到 Phase 2（注入点已在 preview index 外壳中预留）。

## 校验
- `cd packages/server && node --test test/` → **21/21 PASS**（新增 http.test.js 9 项：
  files/file CRUD、generate、patch 三类型写盘生效、history undo/redo/409/深度、
  sandbox start/status/stop、/preview/ 代理取外壳与转译模块、design-md GET/PUT、
  registry、templates 占位、insertSnippet 幂等 import、/api/insert、编辑器静态页）
- `cd packages/editor && node --test test/` → **1/1 PASS**（资源完整性：三栏/代码Tab/Undo/Redo/
  API 端点引用/无渐变）
- 根 `npm run build` → editor build OK（public→dist 3 文件）
- 根 `npm test` → server 21 + shared 7 + editor 1 全绿
- 冒烟 `node scripts/smoke-phase1.mjs` → **SMOKE PHASE 1: PASS**
  （sandbox start → 生成登录页 → 读文件 → preview 三资源 → patch 文案 "冒烟登录" →
   undo 还原 → redo 恢复 → 编辑器页可访问 → stop）

结论：**PASS**
