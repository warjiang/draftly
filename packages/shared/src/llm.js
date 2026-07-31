/**
 * llm.js - LLM Provider 抽象（HTML 草稿模式 M1-M4）
 * 无 API key -> MockProvider（确定性 HTML 模板：登录/仪表盘/落地页），保证离线可测。
 * MockProvider 输出整页 HTML，由 server html-post.js 后处理（sanitize + data-did 注入）。
 */

export class LLMProvider {
  /** @param {Array<{role:string, content:string}>} messages @returns {Promise<string>} */
  async complete(_messages, _opts = {}) {
    throw new Error('LLMProvider.complete not implemented');
  }
}

/* ---------------- MockProvider HTML 草稿模板（M1） ---------------- */

/** Mock HTML 的基准主色；若 messages 含 DESIGN.md primary 则整体替换（确定性） */
const MOCK_HTML_BRAND = '#3f4a5a';

function mockHtmlDoc(title, body, extraCss = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
:root { --brand: ${MOCK_HTML_BRAND}; --bg: #f7f7f5; --surface: #ffffff; --text: #2e2e2c; --muted: #6a6a64; --border: #e6e6e1; }
* { box-sizing: border-box; margin: 0; }
body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
a { color: var(--brand); }
.btn { display: inline-block; padding: 10px 20px; border-radius: 10px; border: 1px solid transparent; background: var(--brand); color: #fff; font-size: 14px; cursor: pointer; text-decoration: none; transition: opacity .15s; }
.btn:hover { opacity: .88; }
.btn.ghost { background: transparent; color: var(--brand); border-color: var(--brand); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.muted { color: var(--muted); font-size: 13px; }
${extraCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

const MOCK_HTML_LOGIN = mockHtmlDoc('登录', `
<main class="center">
  <form class="card login-card">
    <h2>欢迎回来</h2>
    <p class="muted">登录以继续使用你的账户</p>
    <label>邮箱<input type="email" placeholder="you@example.com" /></label>
    <label>密码<input type="password" placeholder="••••••••" /></label>
    <button class="btn" type="button">登录</button>
    <p class="muted" style="text-align:center">还没有账户？<a href="#">立即注册</a></p>
  </form>
</main>`, `
.center { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
.login-card { width: 360px; }
.login-card h2 { margin-bottom: 4px; }
.login-card label { display: block; font-size: 13px; margin: 16px 0 0; }
.login-card input { width: 100%; margin-top: 4px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; }
.login-card .btn { width: 100%; margin: 24px 0 16px; }
`);

const MOCK_HTML_LANDING = mockHtmlDoc('产品落地页', `
<nav class="nav">
  <div class="logo">Draftly</div>
  <div class="nav-links"><a href="#features">功能</a><a href="#pricing">定价</a><a href="#">文档</a></div>
  <a class="btn" href="#">免费开始</a>
</nav>
<header class="hero">
  <span class="badge">v1.0 现已发布</span>
  <h1>用 AI 加速你的界面设计</h1>
  <p class="muted">从一句话到可运行的设计草稿，让原型到代码的距离缩短到几分钟。</p>
  <div><a class="btn" href="#">免费开始</a> <a class="btn ghost" href="#">查看演示</a></div>
</header>
<section id="features" class="grid">
  <div class="card"><h3>可视化编辑</h3><p class="muted">点选元素，实时预览，所见即所得。</p></div>
  <div class="card"><h3>AI 生成</h3><p class="muted">一句话描述页面，AI 自动生成可用草稿。</p></div>
  <div class="card"><h3>设计系统</h3><p class="muted">DESIGN.md 驱动的一致视觉语言。</p></div>
</section>
<footer class="footer muted">© 2026 Draftly</footer>`, `
.nav { display: flex; align-items: center; justify-content: space-between; max-width: 960px; margin: 0 auto; padding: 20px 24px; }
.nav .logo { font-weight: 700; font-size: 18px; }
.nav-links a { margin: 0 12px; text-decoration: none; font-size: 14px; }
.hero { text-align: center; padding: 96px 24px 64px; }
.hero h1 { font-size: 40px; margin: 16px 0; }
.hero p { max-width: 520px; margin: 0 auto 32px; font-size: 15px; }
.badge { display: inline-block; padding: 4px 12px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; max-width: 960px; margin: 0 auto; padding: 48px 24px; }
.footer { text-align: center; padding: 32px 0; border-top: 1px solid var(--border); }
`);

const MOCK_HTML_DASHBOARD = mockHtmlDoc('仪表盘', `
<main class="wrap">
  <header class="top">
    <h1>仪表盘</h1>
    <button class="btn ghost">导出报表</button>
  </header>
  <section class="stats">
    <div class="card"><p class="muted">总用户</p><h3>12,480</h3><span class="delta up">+8.2%</span></div>
    <div class="card"><p class="muted">活跃用户</p><h3>8,932</h3><span class="delta up">+3.1%</span></div>
    <div class="card"><p class="muted">收入</p><h3>¥86,400</h3><span class="delta up">+12.4%</span></div>
    <div class="card"><p class="muted">转化率</p><h3>4.6%</h3><span class="delta down">-0.8%</span></div>
  </section>
  <section class="card">
    <h3>最近订单</h3>
    <table>
      <thead><tr><th>订单号</th><th>客户</th><th>金额</th><th>状态</th></tr></thead>
      <tbody>
        <tr><td>#1001</td><td>张三</td><td>¥1,200</td><td>已支付</td></tr>
        <tr><td>#1002</td><td>李四</td><td>¥860</td><td>待发货</td></tr>
        <tr><td>#1003</td><td>王五</td><td>¥2,340</td><td>已支付</td></tr>
      </tbody>
    </table>
  </section>
</main>`, `
.wrap { max-width: 1100px; margin: 0 auto; padding: 40px 24px; }
.top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stats h3 { font-size: 24px; margin: 4px 0; }
.delta { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
.delta.up { color: #2f7d4f; background: #e7f4ec; }
.delta.down { color: #b4544a; background: #faeceb; }
table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 500; }
`);

const MOCK_HTML_GENERIC = mockHtmlDoc('设计草稿', `
<main class="wrap">
  <h1>页面标题</h1>
  <div class="card">
    <p>这是根据你的描述生成的页面草稿，可继续对话迭代或点选元素修改。</p>
    <a class="btn" href="#">主要操作</a>
    <a class="btn ghost" href="#">次要操作</a>
  </div>
</main>`, `
.wrap { max-width: 720px; margin: 0 auto; padding: 40px 24px; }
.wrap h1 { margin-bottom: 24px; }
.wrap .card p { margin-bottom: 16px; }
`);

/** HTML 草稿模式的 system prompt 标记（server draft-prompts.js buildDraftPrompt 注入，M1） */
export const DRAFT_PROMPT_MARKER = 'HTML 草稿模式';

/** HTML 草稿迭代模式的 system prompt 标记（server draft-prompts.js buildIteratePrompt 注入，M2） */
export const ITERATE_PROMPT_MARKER = 'HTML 草稿迭代模式';

/** HTML 元素局部编辑模式的 system prompt 标记（server draft-prompts.js buildEditElementPrompt 注入，M3） */
export const EDIT_ELEMENT_PROMPT_MARKER = '元素局部编辑模式';

/** 截图修改模式的 system prompt 标记（server draft-prompts.js buildEditByImagePrompt 注入，M5） */
export const EDIT_BY_IMAGE_PROMPT_MARKER = '截图修改模式';

/** 草稿模式确定性输出：关键词路由 + DESIGN.md 主色替换 */
function mockHtmlDraft(text) {
  let page;
  if (/登录|登陆|login|sign[\s-]?in/i.test(text)) page = MOCK_HTML_LOGIN;
  else if (/仪表盘|仪表板|dashboard|后台|管理页/i.test(text)) page = MOCK_HTML_DASHBOARD;
  else if (/落地页|landing|官网|首页|主页|营销/i.test(text)) page = MOCK_HTML_LANDING;
  else page = MOCK_HTML_GENERIC;
  const primary = extractPrimaryColor(text);
  return primary ? page.split(MOCK_HTML_BRAND).join(primary) : page;
}

/** 向元素根标签注入/合并内联 style（M3 Mock 用） */
function injectRootStyle(el, rule) {
  const m = /<([a-zA-Z][\w-]*)(\s[^>]*)?>/.exec(el);
  if (!m) return el;
  const tag = m[0];
  const styleM = /\bstyle\s*=\s*"([^"]*)"/.exec(tag);
  let next;
  if (styleM) {
    next = tag.replace(styleM[0], `style="${styleM[1].replace(/;?\s*$/, '')}; ${rule}"`);
  } else if (/\/\s*>$/.test(tag)) {
    next = tag.replace(/\/\s*>$/, ` style="${rule}"/>`);
  } else {
    next = tag.replace(/>$/, ` style="${rule}">`);
  }
  return el.slice(0, m.index) + next + el.slice(m.index + tag.length);
}

/** 元素局部编辑模式确定性输出：按指令关键词给目标元素根标签注入内联样式（M3） */
function mockHtmlElementEdit(text) {
  const m = /目标元素：\n([\s\S]+?)\n\n修改指令：/.exec(text);
  let el = (m ? m[1].trim() : '') || '<div data-did="0">元素</div>';
  const instruction = text.split('修改指令：').pop() || '';
  // 兜底可见变化；关键词命中时换成对应规则
  let rule = 'box-shadow: 0 4px 16px rgba(59, 130, 246, .35)';
  if (/描边|边框|outline/i.test(instruction)) rule = 'border: 2px solid #3b82f6; background: transparent; color: #3b82f6';
  else if (/背景.{0,4}红|红.{0,4}背景/.test(instruction)) rule = 'background: #dc2626; color: #fff';
  else if (/红/.test(instruction)) rule = 'color: #dc2626';
  else if (/圆角|圆形|胶囊/.test(instruction)) rule = 'border-radius: 999px';
  else if (/字体调大|字号调大|放大/.test(instruction)) rule = 'font-size: 24px';
  else if (/毛玻璃|磨砂/.test(instruction)) rule = 'backdrop-filter: blur(12px); background: rgba(255, 255, 255, .6)';
  return injectRootStyle(el, rule);
}

/** 迭代模式确定性输出：根据指令关键词在当前 HTML 上做小修改（M2） */
function mockHtmlIterate(text) {
  // 从 prompt 中把当前 HTML 抠出来：buildIteratePrompt 格式为 "当前 HTML：\n...\n\n修改指令：..."
  const htmlMatch = /当前 HTML：\n([\s\S]+?)\n\n修改指令：/.exec(text);
  let html = htmlMatch ? htmlMatch[1].trim() : '';
  if (!html) html = '<!doctype html><html><body><h1>草稿</h1></body></html>';
  const instruction = text.split('修改指令：').pop() || '';

  // 深色模式
  if (/深色|暗色|dark|黑色/i.test(instruction)) {
    const darkStyle = '<style>.m2-dark-override { background:#141414 !important; color:#f0f0f0 !important; }</style>';
    html = html.replace(/<\/head>/i, `${darkStyle}</head>`);
    html = html.replace(/<body([\s>]|[\s\S]*?)>/i, '<body$1 class="m2-dark-override">');
  }
  // 改标题 / 加标语
  if (/标题|headline|slogan|标语/i.test(instruction)) {
    html = html.replace(/<h1[\s\S]*?<\/h1>/i, '<h1 data-did="iter">已迭代标题</h1>');
    html = html.replace(/<h2[\s\S]*?<\/h2>/i, '<h2 data-did="iter">已迭代副标题</h2>');
  }
  // 兜底：在 body 结束前加一个可见迭代标记，保证任何指令都有差异
  html = html.replace(/<\/body>/i, '<div id="m2-iterated" style="display:none">iterated</div></body>');
  return html;
}

/**
 * 截图修改模式确定性输出（M5）：离线 Mock 不解析图片，复用迭代关键词修改逻辑，
 * 并注入截图修改标记便于测试与服务端识别。真实 LLM 才会真的「看」截图。
 */
function mockHtmlEditByImage(text) {
  let html = mockHtmlIterate(text);
  if (!/m-img-edit/.test(html)) {
    html = html.replace(/<\/body>/i, '<div id="m-img-edit" data-did="img" style="display:none">image-edit</div></body>');
  }
  return html;
}

/**
 * 从 messages 文本中解析 DESIGN.md front matter 里的 colors.primary。
 * buildDraftPrompt 注入 DESIGN.md 全文，故 system 消息含 `primary: '#xxxxxx'`。
 */
export function extractPrimaryColor(text) {
  const m = /^\s*primary:\s*["']?(#[0-9a-fA-F]{3,8})["']?\s*$/m.exec(text);
  return m ? m[1].toLowerCase() : null;
}

export class MockProvider extends LLMProvider {
  /**
   * 关键词路由：HTML 草稿模式（M1）/迭代（M2）/元素局部编辑（M3）-> 确定性输出。
   * 相同输入永远得到相同输出（离线可测的关键）。
   */
  async complete(messages, _opts = {}) {
    // 支持多模态 message（content 为数组时拼接文本部分；图片仅真实 LLM 使用）
    const text = messages.map((m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) return m.content.map((p) => p.text || '').join('\n');
      return '';
    }).join('\n');
    // 截图修改模式（M5）：当前 HTML + 截图 + 指令 -> 修改后整页 HTML
    if (text.includes(EDIT_BY_IMAGE_PROMPT_MARKER)) return mockHtmlEditByImage(text);
    // HTML 元素局部编辑模式（M3）：元素 outerHTML + 指令 -> 替换后元素
    if (text.includes(EDIT_ELEMENT_PROMPT_MARKER)) return mockHtmlElementEdit(text);
    // HTML 草稿迭代模式（M2）：基于当前 HTML + 指令做确定性小修改
    if (text.includes(ITERATE_PROMPT_MARKER)) return mockHtmlIterate(text);
    // HTML 草稿模式（M1）：返回整页 HTML
    if (text.includes(DRAFT_PROMPT_MARKER)) return mockHtmlDraft(text);
    // 兜底：当作草稿生成
    return mockHtmlDraft(text);
  }
}

/** OpenAI 兼容 Provider：env DRAFTLY_LLM_BASE_URL / DRAFTLY_LLM_API_KEY / DRAFTLY_LLM_MODEL */
export class OpenAICompatibleProvider extends LLMProvider {
  constructor({ baseURL, apiKey, model } = {}) {
    super();
    this.baseURL = (baseURL || process.env.DRAFTLY_LLM_BASE_URL || '').replace(/\/$/, '');
    this.apiKey = apiKey || process.env.DRAFTLY_LLM_API_KEY || '';
    this.model = model || process.env.DRAFTLY_LLM_MODEL || 'gpt-4o-mini';
  }

  async complete(messages, opts = {}) {
    if (!this.baseURL || !this.apiKey) throw new Error('OpenAICompatibleProvider: missing baseURL/apiKey');
    // max_tokens：推理模型（reasoning_content）会在默认 4k 预算内耗尽 token 导致 content 为空，
    // 整页 HTML 草稿输出较长，默认给 32k，可用 DRAFTLY_LLM_MAX_TOKENS / opts.maxTokens 覆盖
    const maxTokens = opts.maxTokens ?? (Number(process.env.DRAFTLY_LLM_MAX_TOKENS) || 32768);
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, temperature: opts.temperature ?? 0.2, max_tokens: maxTokens }),
    });
    if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}

/** 有 DRAFTLY_LLM_API_KEY 用 OpenAI 兼容，否则 Mock */
export function createProvider() {
  if (process.env.DRAFTLY_LLM_API_KEY && process.env.DRAFTLY_LLM_BASE_URL) {
    return new OpenAICompatibleProvider();
  }
  return new MockProvider();
}
