/**
 * jsx.js — 极简 JSX 子集 → `h()` 调用转译器（零依赖，离线降级路径的核心）。
 *
 * 设计决策（Phase 1 离线环境）：
 * sandbox 无法 npm install vite/react/esbuild，因此 preview-server 使用本模块把
 * 生成的 App.jsx（约束在一个可安全转换的 JSX 子集）转译为对内置微型 runtime
 * （preview-runtime.js 的 h/render/Fragment）的调用，浏览器原生 ES module 直接执行。
 *
 * 支持的子集：
 *  - 标签：<div>..</div>、<Button/>、自闭合、嵌套
 *  - Fragment：<>...</>
 *  - 属性：字符串字面量、{表达式}、布尔简写（hidden）、{...spread}
 *  - 子节点：文本、{表达式}、嵌套元素；JSX 注释（花括号包裹的块注释）
 *  - 表达式内部递归支持 JSX（如 {cond ? <A/> : <B/>}）
 *
 * 不做的事：完整 JS 语法解析、TypeScript、JSX 命名空间等。生成的代码必须遵守该子集。
 */

/** 判断字符是否可出现在标签/属性名中 */
const isNameChar = (c) => /[A-Za-z0-9_.\-:$]/.test(c);

class JsxParser {
  constructor(src) {
    this.src = src;
    this.i = 0;
  }

  error(msg) {
    // 截取上下文帮助定位生成代码问题
    const ctx = this.src.slice(Math.max(0, this.i - 30), this.i + 30);
    throw new SyntaxError(`JSX transpile error at offset ${this.i}: ${msg}\n  ...${ctx}...`);
  }

  peek() { return this.src[this.i]; }
  eof() { return this.i >= this.src.length; }

  skipWs() {
    while (!this.eof() && /\s/.test(this.peek())) this.i++;
  }

  /** 读取一个标识符（tag 名 / 属性名），允许 . - : */
  readName() {
    let s = '';
    while (!this.eof() && isNameChar(this.peek())) s += this.src[this.i++];
    if (!s) this.error('expected name');
    return s;
  }

  /** 读取平衡括号表达式 { ... }（假设当前字符是 '{'），返回内部源码（已递归转译 JSX） */
  readBraced() {
    if (this.peek() !== '{') this.error("expected '{'");
    this.i++; // consume {
    let depth = 1;
    const start = this.i;
    while (!this.eof() && depth > 0) {
      const c = this.peek();
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === "'" || c === '"' || c === '`') this.skipString(c);
      else if (c === '/' && (this.src[this.i + 1] === '/' || this.src[this.i + 1] === '*')) this.skipComment();
      if (depth > 0) this.i++;
    }
    if (depth !== 0) this.error("unbalanced '{'");
    const inner = this.src.slice(start, this.i);
    this.i++; // consume final }
    return transformJsx(inner); // 表达式内部可能还有 JSX
  }

  skipString(quote) {
    this.i++;
    while (!this.eof() && this.peek() !== quote) {
      if (this.peek() === '\\') this.i++;
      // 模板字符串里的 ${} 可能含 JSX，但生成子集不使用，保守跳过
      this.i++;
    }
  }

  skipComment() {
    if (this.src[this.i + 1] === '/') {
      while (!this.eof() && this.peek() !== '\n') this.i++;
    } else {
      while (!this.eof() && !(this.peek() === '*' && this.src[this.i + 1] === '/')) this.i++;
      this.i++;
    }
  }

  /** 解析一个 JSX 元素/Fragment，返回 h() 调用字符串。当前字符必须是 '<' */
  parseElement() {
    if (this.peek() !== '<') this.error("expected '<'");
    this.i++;
    if (this.peek() === '>') { // Fragment
      this.i++;
      const children = this.parseChildren(null);
      return `h(Fragment,null${children.length ? ',' + children.join(',') : ''})`;
    }
    const name = this.readName();
    const props = [];
    // 属性
    for (;;) {
      this.skipWs();
      const c = this.peek();
      if (c === '/' || c === '>') break;
      if (c === '{') { // spread
        const inner = this.readBraced();
        const trimmed = inner.trim();
        if (!trimmed.startsWith('...')) this.error('only {...spread} braces allowed in props');
        props.push(`__SPREAD__${trimmed.slice(3)}`);
        continue;
      }
      const attr = this.readName();
      this.skipWs();
      if (this.peek() === '=') {
        this.i++;
        this.skipWs();
        if (this.peek() === '"' || this.peek() === "'") {
          const q = this.peek();
          const s0 = ++this.i;
          while (!this.eof() && this.peek() !== q) this.i++;
          const val = this.src.slice(s0, this.i);
          this.i++;
          props.push(`${JSON.stringify(attr)}:${JSON.stringify(val)}`);
        } else if (this.peek() === '{') {
          props.push(`${JSON.stringify(attr)}:(${this.readBraced()})`);
        } else this.error('attribute value must be string or {expr}');
      } else {
        props.push(`${JSON.stringify(attr)}:true`); // 布尔简写
      }
    }
    let propsJs = 'null';
    if (props.length) {
      const spreads = props.filter((p) => p.startsWith('__SPREAD__'));
      const normal = props.filter((p) => !p.startsWith('__SPREAD__'));
      propsJs = `{${normal.join(',')}}`;
      for (const s of spreads) propsJs = `Object.assign(${propsJs},${s.slice(10)})`;
    }
    this.skipWs();
    if (this.peek() === '/') { // 自闭合
      this.i++;
      if (this.peek() !== '>') this.error("expected '>' after '/'");
      this.i++;
      return `h(${tagExpr(name)},${propsJs})`;
    }
    if (this.peek() !== '>') this.error("expected '>'");
    this.i++;
    const children = this.parseChildren(name);
    return `h(${tagExpr(name)},${propsJs}${children.length ? ',' + children.join(',') : ''})`;
  }

  /**
   * 解析子节点直到匹配的闭合标签（tagName=null 表示 Fragment 闭合 '</>'）。
   */
  parseChildren(tagName) {
    const out = [];
    let text = '';
    const flushText = () => {
      const t = text.replace(/\s+/g, ' ');
      // JSX 语义：纯空白文本忽略；首尾按行修剪
      if (t.trim()) out.push(JSON.stringify(t.trim()));
      text = '';
    };
    for (;;) {
      if (this.eof()) this.error('unclosed element ' + (tagName || '<>'));
      const c = this.peek();
      if (c === '<') {
        if (this.src[this.i + 1] === '/') { // 闭合标签
          this.i += 2;
          this.skipWs();
          if (tagName === null) {
            if (this.peek() !== '>') this.error("expected '>' closing fragment");
          } else {
            const close = this.readName();
            if (close !== tagName) this.error(`mismatched closing tag </${close}> for <${tagName}>`);
            this.skipWs();
          }
          if (this.peek() !== '>') this.error("expected '>'");
          this.i++;
          flushText();
          return out;
        }
        flushText();
        out.push(this.parseElement());
      } else if (c === '{') {
        if (this.src.startsWith('{/*', this.i)) { // 注释
          while (!this.eof() && !this.src.startsWith('*/}', this.i)) this.i++;
          this.i += 3;
          continue;
        }
        flushText();
        const inner = this.readBraced();
        if (inner.trim()) out.push(`(${inner})`);
      } else {
        text += c;
        this.i++;
      }
    }
  }
}

/** 标签名 → 表达式：小写为字符串字面量，大写为标识符（组件函数） */
function tagExpr(name) {
  if (/^[a-z]/.test(name)) return JSON.stringify(name);
  return name;
}

/** 前一个非空白字符是否允许 JSX 起始（表达式位置启发式） */
function canStartJsx(prev) {
  return prev === null || '([{=,:;!&|?+-*%^~<>'.includes(prev);
}

/**
 * 扫描任意 JS 源码，把表达式位置上的 JSX 转译为 h() 调用。
 * 字符串/模板/注释安全跳过。
 */
export function transformJsx(code) {
  let out = '';
  let i = 0;
  let prev = null; // 上一个非空白非注释字符
  let prevWord = '';
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < n && code[j] !== q) { if (code[j] === '\\') j++; j++; }
      out += code.slice(i, j + 1);
      i = j + 1;
      prev = q;
      prevWord = '';
      continue;
    }
    if (c === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) {
      let j;
      if (code[i + 1] === '/') { j = i; while (j < n && code[j] !== '\n') j++; }
      else { j = i + 2; while (j < n && !(code[j] === '*' && code[j + 1] === '/')) j++; j += 2; }
      out += code.slice(i, j);
      i = j;
      continue;
    }
    if (c === '<' && /[A-Za-z>]/.test(code[i + 1] || '') &&
        (canStartJsx(prev) || prevWord === 'return' || prevWord === 'case')) {
      const p = new JsxParser(code);
      p.i = i;
      const js = p.parseElement();
      out += js;
      i = p.i;
      prev = ')';
      prevWord = '';
      continue;
    }
    out += c;
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) { prevWord += c; }
    else { prevWord = ''; }
    prev = c;
    i++;
  }
  return out;
}

/**
 * 模块级转换：预览用的 App 模块。
 *  - 去掉对 'react' 的 import（子集不使用真 React）
 *  - '@/components/ui/x' → '/components/ui/x.js'（preview-server 内置组件实现）
 *  - 相对导入 './x' → './x.jsx'（浏览器需要显式扩展名）
 *  - 'export default function App' → 'function App'（导出由包装层处理）
 *  - 其余 export 前缀保留（具名导出包装层不依赖）
 * @returns {{ code: string, hasDefault: boolean }}
 */
export function transformModule(code, { filePath = '/src/App.jsx' } = {}) {
  let src = code;
  // 去 react import（整行删除）
  src = src.replace(/^\s*import\s+[^;]*?from\s+['"]react['"];?\s*$/gm, '');
  // '@/...' → '/@/...' 由 preview-server 路由解析；这里直接映射到内置组件路径
  src = src.replace(/from\s+['"]@\/components\/ui\/([\w-]+)['"]/g,
    (_, n) => `from '/components/ui/${n}.js'`);
  src = src.replace(/from\s+['"]@\/([\w./-]+)['"]/g, (_, n) => `from '/lib/${n}.js'`);
  // 相对导入补扩展名
  src = src.replace(/from\s+['"](\.{1,2}\/[\w./-]*?)(['"])/g, (m, p, q) => {
    if (/\.(jsx?|css|json)$/.test(p)) return m;
    return `from '${p}.jsx${q}`;
  });
  let hasDefault = false;
  if (/export\s+default\s+/.test(src)) {
    hasDefault = true;
    src = src.replace(/export\s+default\s+/, '');
  }
  const body = transformJsx(src);
  return { code: body, hasDefault, filePath };
}

/**
 * 把一个 JSX 模块包装成可执行的预览入口模块：
 * 引入微型 runtime，渲染默认 App 组件到 #root。
 */
export function wrapPreviewModule(code, { filePath = '/src/App.jsx' } = {}) {
  const { code: body, hasDefault } = transformModule(code, { filePath });
  const header = `import { h, render, Fragment } from '/__runtime.js';\n`;
  // 兜底：没有 default export 时约定函数名 App
  const footer = hasDefault
    ? `\n;render(h(App, null), document.getElementById('root'));\n`
    : `\n;if (typeof App === 'function') render(h(App, null), document.getElementById('root'));\n`;
  return header + body + footer;
}
