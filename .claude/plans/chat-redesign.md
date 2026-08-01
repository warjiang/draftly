# 重设计方案：左右分栏 + Chat UI

## 目标
把当前「三栏（草稿列表 + 预览 + 右侧操作栏）+ 顶栏生成表单」重构为**两栏**：
- **左栏**：当前 HTML 草稿预览（iframe `srcdoc`）
- **右栏**：Chat UI，统一所有操作入口（生成 / 迭代 / 元素修改 / 截图修改）

后端 REST API **不动**（已支持 generate / list / read / iterate / edit-element / edit-by-image / rollback / export / templates）。冒烟测试只校验 `drafts.html` 引用 `drafts-app.js`，不受影响。本次只改前端 `packages/editor/public/` 三个文件并同步 `dist/`。

## 布局

```
顶栏: draftly | [草稿: 标题 ▾] [+新草稿] | [🕘历史]
┌──────────────────────┬────────────────────────┐
│ 左：预览              │ 右：对话                │
│ ┌ stage-bar ───────┐ │ ┌ 消息列表 ──────────┐ │
│ │标题·v3 [🎯点选]   │ │ │ user / assistant   │ │
│ │[⬇导出] [</>源码]  │ │ │ [方案1][方案2]卡片  │ │
│ └──────────────────┘ │ │ ...                │ │
│ ┌ iframe 预览 ─────┐ │ └────────────────────┘ │
│ │                  │ │ ┌ 输入区 ────────────┐ │
│ │                  │ │ │ [📎截图✕] [🎯div✕]  │ │
│ └──────────────────┘ │ │ ┌ textarea ──────┐ │ │
│                      │ │ │ 输入指令…       │ │ │
│ 空态: 在右侧对话生成  │ │ └────────────────┘ │ │
│      第一个草稿       │ │ [风格▾][方案▾] [↑] │ │
│                      │ └────────────────────┘ │
└──────────────────────┴────────────────────────┘
版本历史: 顶栏「历史」打开右抽屉
源码弹层: 保留现状，从 stage-bar 触发
```

## 顶栏（#topbar）
- brand
- 草稿下拉 `#draft-select`：展开当前所有草稿（标题 + vN + 时间），选中 → `selectDraft(id)`（切草稿 = 开新对话）
- `#btn-new` 新建草稿：清空预览 + 对话回空态（`current = null`）
- `#btn-history`：打开版本历史抽屉（仅 `current` 存在时可用）

## 左栏（#preview-pane）
- `#stage-bar`：`标题 · v3` + `#btn-pick`（点选修改）+ `#btn-export` + `#btn-source`
- `#preview` iframe（srcdoc）
- `#stage-empty` 空态：「在右侧对话中描述需求，生成第一个草稿」
- 选中元素 chip（点选模式选中后浮在 stage-bar）：`🎯 <div> ✕`

## 右栏（#chat-pane）
- `#chat-header`：「对话」+ 当前草稿标题
- `#chat-messages`（滚动）：
  - **user** 气泡（右对齐）：文本 + 可选截图缩略图 + 可选「选中元素」标签
  - **assistant** 气泡（左对齐）：
    - generate 单个：「✓ 已生成「标题」(v1)」
    - generate 多个：「✓ 生成 N 个方案，点击选用」+ 变体卡片（方案 N · 标题 / 选用按钮，已选用标记）
    - iterate：「✓ 已迭代到 vN」
    - edit-element：「✓ 已修改 <div>」
    - edit-by-image：「✓ 已按截图修改，vN」
    - error：「✗ 失败：reason」
    - pending：spinner + 「生成中…/迭代中…」
- `#chat-input`（sticky 底部）：
  - 上下文 chips 行：`#chip-image`（📎 截图已附 ✕）、`#chip-select`（🎯 <div> ✕）—— 仅存在时显示
  - `#chat-textarea`（回车发送，Shift+回车换行）
  - 底部行：`#gen-style`（风格 ▾）+ `#gen-variants`（方案数 ▾）+ `#btn-send`（↑）
    - 风格 / 方案数**仅空态（无 current）显示**；迭代时 `hidden`

## 发送逻辑（按状态自动决定 API，单入口）
```
send():
  text = textarea.trim();  !text → 提示并返回
  if !current:                  → POST /api/draft/generate {prompt, variants, style?}
                                   1 个  → selectDraft(d.id)
                                   多个  → 变体卡片 + 自动选用第 1 个载入预览
  else if image:                → POST /api/draft/:id/edit-by-image {image, instruction}
  else if selected:             → POST /api/draft/:id/edit-element {did, instruction}；清选中
  else:                         → POST /api/draft/:id/iterate {instruction}
  成功 → loadDrafts()（刷顶栏下拉）+ selectDraft(id)（刷预览）
  失败 → assistant error 气泡
```
- 空态附截图：提示「截图修改需先有草稿」
- 选中元素 + 截图同存：截图优先（edit-by-image），选中保留

## 对话与草稿的关系
- **一个对话 = 一个草稿**：`+新草稿` 进空态；草稿下拉切换 = 载入该草稿并开新对话（系统消息「已载入「标题」v3，发送消息继续迭代」）
- 对话**仅存内存**（按 `draftId` 缓存 `chats` Map，切回草稿可恢复本次会话对话）；刷新页面丢对话，但版本历史持久化在「历史」抽屉
- 变体卡片点击 → 切到对应草稿（= 新对话）

## 版本历史抽屉（#history-drawer）
- 右侧 slide-over，列 `current` 版本（新→旧）：vN 徽标（生成/迭代）+ instruction + 回退按钮（非当前版本）
- 点行 → `selectDraft(id, v)` 预览该版本；回退 → `/rollback`（复用现有逻辑）

## 保留的现有能力
- **点选修改（M3）**：`#btn-pick` 切 pickMode；iframe load 重挂监听；选中 → `#chip-select`；发送（无截图）→ edit-element；发送后清选中；切草稿/版本清选中
- **截图修改（M5）**：`#chip-image` 点击触发文件选择；全局 Ctrl+V 粘贴；有 current → 发送走 edit-by-image
- **源码弹层**：`#source-modal` 样式 + `[hidden]` 修复保留，从 stage-bar 触发

## CSS 重写要点（drafts.css）
- 复用设计 token（`--bg/--surface/--primary/...`）
- `#layout` flex 行：左 `#preview-pane` `flex:1`，右 `#chat-pane` 固定宽 ~420px
- 气泡：`.msg` `.msg.user` `.msg.assistant` `.msg.pending` `.msg.error`
- 变体卡片：`.variant-card` `.variant-card.chosen`
- chips：`.chip` `.chip-image` `.chip-select`
- 下拉：`.dropdown-menu`；抽屉：`#history-drawer`（translateX 过渡）
- 保留 `#source-modal` + `#stage-view[hidden]` / `#source-modal[hidden]` 修复

## 文件改动
1. `packages/editor/public/drafts.html` — 重写结构
2. `packages/editor/public/drafts.css` — 重写样式
3. `packages/editor/public/drafts-app.js` — 重写为 chat 驱动逻辑（复用 `api()` / `escapeHtml()` / pick 绑定 / 粘贴 / 版本渲染等现有函数）
4. `packages/editor/dist/` — `npm run build`（= `cp -r public/* dist/`）同步

## 不在本次范围
- 后端 API / draft-generate / prompts / 存储：不动
- 对话持久化到磁盘：不做（版本历史已覆盖持久化）
- 变体卡片缩略图：v1 不做，仅文字卡片（避免聊天区多 iframe）

## 验证
- `npm run dev` 手动走一遍：空态生成 → 多变体卡片选用 → 迭代 → 点选元素修改 → 粘贴截图修改 → 历史抽屉回退 → 导出 → 源码弹层
- `npm run smoke` 仍通过（只校验 API + `drafts.html` 引用 `drafts-app.js`）
