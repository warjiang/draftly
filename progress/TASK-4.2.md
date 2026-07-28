# TASK-4.2 校验日志 — 桥接服务（Week11）

## 实现
- `packages/cli/src/bridge.js` — `startBridge({ target, port, projectDir, log })`（SPEC 2.4）：
  - **HTTP 代理**：`http.request` 转发 target（强制 `accept-encoding: identity`，剥离 content-length/encoding 避免压缩体注入失败）；`text/html` 且 200 的响应在 `</body>` 前（无 `</body>` 则尾部追加）注入 **INSPECT_SOURCE**（复用 `packages/server/src/preview-runtime.js`，postMessage 协议与 Phase 2 完全一致：`draftly:inspect:set` / `draftly:inspect:select`，payload 含 loc/tagName/className/textContent/computedStyles）+ SSE HMR 客户端；非 HTML（css/json/404 等）原样透传。
  - **WS/HMR 降级决策**：离线无 ws 库，不做 WS 帧透传。`server.on('upgrade')` → 回 `501 Not Implemented` + 关闭 socket + 记日志；HMR 由桥接层 SSE 通道 `/__bridge-hmr` 兜底（`fs.watch(projectDir, recursive)` 防抖 120ms → `data: reload` → 注入客户端 `location.reload()`）。即「代理模式 HMR 经桥接层 SSE 重载」。
  - **桥接文件 API**：`/bridge/file?path=` GET 读 / PUT 写（限定 projectDir 内，`path.resolve` 前缀校验防穿越 → 400）。PUT 两种模式：`{ content }` 整写（自动 mkdir -p）；`{ patch: { loc, type: class|text|style, value } }` 复用 `packages/server/src/ast.js` 的 patchElement* 局部修改（格式保留）。
  - 编辑器 iframe 指向 bridge url 即可 Inspect（同源注入）。
  - CLI：`draftly bridge --target <url> [--port 4600] [--dir]`（缺 --target 报错退出）。

## 校验命令与结果
```
node --test packages/cli/test/bridge.test.js   # 4/4 pass
npm test                                        # 95/95 pass（cli 17, editor 4, server 65, shared 9）
node scripts/smoke-phase1.mjs / 2 / 3           # PASS / PASS / PASS
```
集成覆盖：node http server 模拟 target → startBridge → 断言 HTML 注入 inspect 脚本（`__DRAFTLY_INSPECT__` 位于 `</body>` 前）、无 body 标签时尾部注入、CSS/JSON 透传、404 透传；/bridge/file GET（200/404/穿越 400）、PUT 整写落盘、PUT ast patch（class 替换且其余内容不动）；WS upgrade → 501 + 降级日志；SSE `/__bridge-hmr` 首包 `: ok`。

## 已知限制
- target 的 gzip/br 响应通过 `accept-encoding: identity` 规避；target 强制压缩时不注入（原样透传 body，仍剥离 encoding 头可能有偏差——当前实现对压缩体仅删头不解码，视为限制）。
- WS 降级后 target dev server 自身的 WS HMR 不可用，由桥接 SSE reload 兜底。
