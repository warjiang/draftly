# TASK 1.2 — @draftly/shared + 生成管线

## 实现
- `packages/shared/src/design-md.js`：parseDesignMd / serializeDesignMd / defaultDesignMd
  （YAML 子集 frontmatter：map/列表/标量/缩进嵌套；round-trip 测试通过）。
- `packages/shared/src/registry.js` + `component-registry.json`：20 个组件条目
  （Button/Card/Input/Textarea/Label/Dialog/Tabs/Badge/Avatar/Separator/Alert/Table/Switch/
  Checkbox/Radio/Select/Progress/Tooltip/Accordion/Breadcrumb），schema 按 SPEC 2.1；
  validateRegistry 返回错误列表；componentIndex 供 prompt 注入。
- `packages/shared/src/llm.js`：LLMProvider / MockProvider（登录页/仪表盘/落地页确定性模板，
  输出约束在 jsx.js 可转换子集）/ OpenAICompatibleProvider（env 驱动）/ createProvider。
- `packages/server/src/generate.js`：buildGenerationPrompt（注入组件索引 + DESIGN.md 颜色/字体/
  间距约束 + 输出规约）；generatePage（生成→extractCode→injectSourceLoc→写 src/App.jsx→读回校验）。
- `packages/server/src/ast.js`（Phase 1 简化版）：injectSourceLoc（行扫描注入 `file:line:col`，幂等）、
  findOpeningTag/findElementByLoc、patchElementClass/Text/Style（仅触碰目标标签；非纯文本子节点
  拒绝 text patch）。parseCode/serialize 为显式降级占位。

## 降级决策
1. **npm workspaces 链接失败**：/mnt 不支持 symlink（npm ENOTSUP），server 改用相对路径
   `../../shared/src/*.js` 导入 shared。影响：无（接口不变）。
2. **ast.js 不用 recast/babel**：离线无法安装依赖。Phase 1 用行扫描内核，接口形状与 SPEC 一致，
   Phase 2 换 recast 内核时调用方零改动。影响：patch 仅支持「标签名与 < 同行」的代码
   （MockProvider 模板满足）；cn()/clsx() className 形态 Phase 2 处理。
3. **data-source-loc 生成期注入**（SPEC 允许的简化）：generatePage 统一调 injectSourceLoc。

## 校验
- `cd packages/shared && node --test test/` → **7/7 PASS**
  （design-md round-trip / overrides 深合并 / 无 frontmatter 容错 / 内置 registry 合法 20 组件 /
  validateRegistry 错误场景 / MockProvider 三类页面确定性 / createProvider 无 key→Mock）
- `cd packages/server && node --test test/` → **12/12 PASS**
  （含新增：prompt 注入断言、extractCode、injectSourceLoc 幂等、ast patch text/class/style、
  findElementByLoc、generatePage 端到端：生成→写文件→start→HTTP 取到转译模块含 h(Card)/
  data-source-loc/组件 import 重写、参数校验）

结论：**PASS**
