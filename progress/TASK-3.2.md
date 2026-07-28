# TASK-3.2 校验日志 — 网站设计系统提取（Week8）

## 实现：`packages/server/src/extract.js`（纯函数核心 + 可选 URL 增强）

`extractDesign({ html, cssTexts }) → { designMd, tokens, tailwindCss }`，全部确定性（同输入同输出）：

- **颜色聚类**：正则提取 hex/rgb(a)/hsl(a)/常见命名色 → 全部归一化 `#rrggbb`（hsl→rgb 换算、alpha 剥离、3/4 位展开）；按出现频次加权。K-means：k 自适应 `clamp(ceil(unique/2), 4, 8)`，欧氏 RGB 距离，**确定性 seed**（频次降序等距取初始中心，固定 25 轮迭代，无随机数）。簇代表色取簇内频次最高的原始色（medoid，比质心忠实）。角色映射：primary=饱和度最高簇；background=低饱和且明度极端（lum<48 或 >207）中 share 最高簇；text=与 background 明度差最大的中性簇；surface=剩余 share 最高簇；muted/border 由 text/background 混合派生。
- **字体层级**：font-size 频次统计 → body=频率最高值，大于 body 的尺寸降序映射 h1..h6，最小值 → small；font-family 取首个字体的频次众数。
- **间距基数**：padding/margin 全数值集合（含简写展开）→ GCD 推断基数，clamp 2–16px，失败回退 8px。
- **radius/shadow**：众数统计（同频次按字典序确定性 tie-break），shadow 排除 none。
- **tokens schema（固定）**：`{ colors:[{hex,share,role}], typography:{fontFamily,scale}, spacing:{unit,values}, radius:{mode,values}, shadows:{mode,values} }`。
- **tailwindCss**：`:root` CSS 变量（--color-primary/--spacing-unit/--radius-md/--shadow-sm/--font-size-* 等）+ `@theme` 头注释。
- **可选增强** `fetchSiteAssets(url)`：有网络时 fetch HTML + 内联 <style> + 前 8 个 link[rel=stylesheet]；失败抛 `EXTRACT_OFFLINE`。
- **HTTP**：`POST /api/extract { html, css }`（css 字符串或数组，离线核心路径）；`POST /api/extract { url }` 无网络 → **501 + hint 引导粘贴 HTML**；空请求 → 400。

## fixture
`packages/server/test/fixtures/linear-ish.html` / `linear-ish.css`：仿 Linear（深色 #0f1011 背景、#5e6ad2 主色、Inter、8px 基数、8px 圆角、rgba(0,0,0,0.4) 阴影）。

## 校验命令与结果
```
node --test packages/server/test/extract.test.js   # 7/7 pass
npm test                                            # 71/71 pass（shared 11, server 57, editor 3）
node scripts/smoke-phase1.mjs                        # PASS
node scripts/smoke-phase2.mjs                        # PASS
node scripts/smoke-phase3.mjs                        # PASS（含 fixture 断言 + 501 离线路径）
```
关键断言：fixture → designMd 过 validateDesignMd 且主色 ≈ #5e6ad2（RGB 容差 40）、背景 ≈ #0f1011；字体层级 h1>h2>h3>body 有序、fontFamily=Inter；spacing.unit ∈ {4px,8px}（fixture 得 4px：含 4px badge padding）；tokens/tailwindCss 结构合法；聚类与整体输出确定性（两次调用 deepEqual）。

## 已知限制
- medoid 代表色使主色精确命中原始 hex；质心坐标未输出（不需要）。
- URL 抓取未执行 JS（无 Playwright，按 SPEC 2.2 说明做成可选增强）；动态注入的样式不覆盖，可由用户粘贴 CSS 补齐。
- box-shadow 含多层（逗号分隔）时按整条统计众数，不拆分。
