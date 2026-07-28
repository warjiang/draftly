# TASK-2.1 — Week4 Inspect 选择器

## 实现
- `packages/shared/src/inspect.js`（新增）：消息协议单一事实来源。
  - 父→iframe `{type:'draftly:inspect:set', enabled}`；iframe→父 `{type:'draftly:inspect:select', payload}`
  - payload schema：`{ loc, tagName, className, textContent, computedStyles }`，computedStyles 限定
    color/fontSize/fontFamily/backgroundColor/borderRadius/padding/margin
  - 校验函数：`validateSelectPayload`（错误列表）、`validateSelectMessage`、`parseSelectMessage`（非法→null）、`validateSetMessage`
- `packages/server/src/preview-runtime.js`：`INSPECT_STUB` 占位 → `INSPECT_SOURCE` 完整实现
  （hover outline 浮层、click 捕获选中、`getComputedStyle` 采集、postMessage 回传；
  `'*'` 仅在 inspect 启用且用户点选时发送，跨域 bridge 场景兼容；`INSPECT_STUB` 别名保留兼容）。
- `packages/server/src/http.js`：新增静态路由 `/shared/*` → `packages/shared/src`，
  编辑器以原生 ESM `import ... from '/shared/inspect.js'` 复用协议（无构建，降级注明）。
- 编辑器：`index.html` 顶栏加「⌖ Inspect 模式」开关 + 属性面板新增 className/textContent/computedStyles 展示区；
  `app.js` 移除 Phase 1 同源直连 click 方案，改为 postMessage + schema 校验（跨域可用）；
  iframe 重载后自动重发开关；`styles.css` 增加开关/样式表风格（浅色低饱和，无渐变）。

## 校验
- `npm test`：editor 2/2、server 21/21（新增 inspect.test.js 7 项：注入点、脚本内容、schema 正/反例、
  preview-server 路由、/shared/inspect.js 暴露）、shared 7/7 —— 全绿，Phase 1 测试未破坏。
- `node scripts/smoke-phase2.mjs`：PASS（外壳注入断言、postMessage 负载解析正/反例、编辑器协议引用）。
- `node scripts/smoke-phase1.mjs`：PASS（基线回归）。

## 降级/说明
- 离线无浏览器自动化（Playwright 不可用）：hover/click 行为以脚本内容断言 + 协议解析单测覆盖，
  真实 DOM 交互经人工路径验证（同源 /preview 与跨域均走同一注入脚本）。
- 结论：PASS
