/**
 * ast.js — 源码定位与修改（SPEC 2.2 接口）。
 *
 * Phase 2 强化：离线无法安装 recast/@babel（npm registry 不可达），本模块用
 * 「行扫描 + 括号/引号感知扫描」实现 injectSourceLoc / patchElement*，接口形状与 SPEC 2.2 一致。约束：
 *  - 生成代码每个 JSX 开标签的标签名与 '<' 在同一行（MockProvider 模板已满足）
 *  - patch 只作用于 loc 指向的开标签/文本区间，其余字节逐字节保留（测试以 diff 行数断言）
 *  - className 三形态：字符串字面量 / cn(...) / clsx(...)；style={{...}} 合并覆盖同名字段
 */

/** loc 格式 "file:line:col"，line/col 1-based，col 指向 '<' 之后标签名起始 */
export function parseLoc(loc) {
  const m = /^(.+):(\d+):(\d+)$/.exec(loc || '');
  if (!m) throw new Error(`bad loc: ${loc}`);
  return { file: m[1], line: Number(m[2]), col: Number(m[3]) };
}

/**
 * 为每个 JSX 开标签注入 data-source-loc="file:line:col"。
 * 简化策略：逐行扫描 '<Tag'（Tag 为标识符、非闭合/声明），且该开标签尚无 data-source-loc。
 */
export function injectSourceLoc(code, file) {
  const lines = code.split('\n');
  const out = lines.map((line, idx) => {
    // 跳过 import 行与注释行
    if (/^\s*(import|\/\/|\/\*|\*)/.test(line)) return line;
    // lookahead 不消耗下一字符：兼容 `<Tag` 位于行尾的多行开标签
    return line.replace(/<([A-Za-z][A-Za-z0-9]*)(?=\s|>|\/|$)/g, (m, tag, offset) => {
      // 该行该标签已有 loc 则跳过（幂等）
      const following = line.slice(offset);
      if (/^<[A-Za-z][A-Za-z0-9]*[^>]*data-source-loc=/.test(following.split('>')[0] ?? '')) return m;
      const col = offset + 2; // 1-based，标签名起始列
      return `<${tag} data-source-loc="${file}:${idx + 1}:${col}"`;
    });
  });
  return out.join('\n');
}

/** 找到 loc 指向的开标签在源码中的区间 {start, end, tag}（end 为 '>' 后一位） */
export function findOpeningTag(code, loc) {
  const { line, col } = parseLoc(loc);
  const lines = code.split('\n');
  const lineText = lines[line - 1];
  if (lineText == null) return null;
  // col 指向标签名起始，回退到 '<'
  const lt = col - 2;
  if (lt < 0 || lineText[lt] !== '<') return null;
  const tagMatch = /^<([A-Za-z][A-Za-z0-9]*)/.exec(lineText.slice(lt));
  if (!tagMatch) return null;
  const tag = tagMatch[1];
  // 从 '<' 起扫描到未被引号包裹的 '>'
  let i = offsetOf(lines, line, lt) + 1;
  let quote = null;
  let braceDepth = 0;
  while (i < code.length) {
    const c = code[i];
    if (quote) {
      if (c === quote && code[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    else if (c === '>' && braceDepth === 0) return { start: offsetOf(lines, line, lt), end: i + 1, tag };
    i++;
  }
  return null;
}

function offsetOf(lines, line1based, col0) {
  let off = 0;
  for (let i = 0; i < line1based - 1; i++) off += lines[i].length + 1;
  return off + col0;
}

/* ---------- Phase 2：括号/引号感知的扫描工具 ---------- */

/**
 * 从 s[openIdx]（开括号）起找到匹配的闭括号下标；跳过引号字符串与嵌套。
 * @returns {number} 闭括号下标；找不到 → -1
 */
export function matchBracket(s, openIdx, open, close) {
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote && s[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 提取片段中的字符串字面量内容（用于 cn/clsx 参数 token 比对） */
function stringLiterals(src) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1] ?? m[2]);
  return out;
}

/** 按顶层分隔符切分（跳过字符串与嵌套括号），保留原始空白 */
function splitTopLevel(src, sep) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(src.slice(start));
  return parts;
}

/* ---------- class：三种 className 形态 ---------- */

/**
 * 修改目标元素的 class。
 * ① className="..."（字符串字面量）→ 整体替换值
 * ② className={cn("a", cond && "b")} → 追加缺失 token 为新字符串参数（条件/表达式参数不动）
 * ③ className={clsx(...)} → 同 ②
 * 无 className → 在标签名后新建 className="..."
 * 其余 className={expr}（变量/模板等）→ 显式报错
 */
export function patchElementClass(code, loc, newClass) {
  const pos = findOpeningTag(code, loc);
  if (!pos) throw new Error(`element not found at ${loc}`);
  const tagSrc = code.slice(pos.start, pos.end);
  const patched = patchClassInTag(tagSrc, String(newClass), loc);
  return code.slice(0, pos.start) + patched + code.slice(pos.end);
}

function patchClassInTag(tagSrc, newClass, loc) {
  // ②③ cn(...) / clsx(...) 调用表达式
  const callRe = /className=\{\s*(cn|clsx)\(/;
  const m = callRe.exec(tagSrc);
  if (m) {
    const openIdx = m.index + m[0].length - 1; // '(' 下标
    const closeIdx = matchBracket(tagSrc, openIdx, '(', ')');
    if (closeIdx < 0) throw new Error(`className call at ${loc} has unbalanced parens`);
    const inner = tagSrc.slice(openIdx + 1, closeIdx);
    const tokens = newClass.split(/\s+/).filter(Boolean);
    const present = new Set(stringLiterals(inner).flatMap((s) => s.split(/\s+/).filter(Boolean)));
    const missing = tokens.filter((t) => !present.has(t));
    if (missing.length === 0) return tagSrc; // 全部已存在 → 无变化
    const head = inner.replace(/\s+$/, ''); // 保留尾部空白（如换行）
    const glue = head.trim() === '' ? '' : head.endsWith(',') ? ' ' : ', ';
    const addition = glue + missing.map((t) => JSON.stringify(t)).join(', ');
    const at = openIdx + 1 + head.length;
    return tagSrc.slice(0, at) + addition + tagSrc.slice(at);
  }
  // ① 字符串字面量
  const strRe = /className=("[^"]*"|'[^']*')/;
  if (strRe.test(tagSrc)) return tagSrc.replace(strRe, `className=${JSON.stringify(newClass)}`);
  // 其余表达式形态显式拒绝
  if (/className=\{/.test(tagSrc)) {
    throw new Error(`className at ${loc} is a non-cn/clsx expression; patch unsupported`);
  }
  // 无 className → 新建
  return tagSrc.replace(/^(<[A-Za-z][A-Za-z0-9]*)/, `$1 className=${JSON.stringify(newClass)}`);
}

/* ---------- style：style={{ ... }} 合并 ---------- */

/**
 * 添加/合并内联样式对象。
 * 已有 style={{ ... }} → 同名字段覆盖（其余字段原文保留）、新字段追加；
 * style={expr} 非对象字面量 → 显式报错；无 style → 新建。
 */
export function patchElementStyle(code, loc, styleObj) {
  const pos = findOpeningTag(code, loc);
  if (!pos) throw new Error(`element not found at ${loc}`);
  if (!styleObj || typeof styleObj !== 'object' || Array.isArray(styleObj)) {
    throw new Error('patchElementStyle: styleObj must be a plain object');
  }
  const tagSrc = code.slice(pos.start, pos.end);
  const patched = patchStyleInTag(tagSrc, styleObj, loc);
  return code.slice(0, pos.start) + patched + code.slice(pos.end);
}

function patchStyleInTag(tagSrc, styleObj, loc) {
  const m = /style=\{/.exec(tagSrc);
  if (m) {
    const braceIdx = m.index + m[0].length - 1; // '{' 下标（外层表达式括号）
    if (tagSrc[braceIdx + 1] !== '{') {
      throw new Error(`style at ${loc} is a non-object expression; patch unsupported`);
    }
    const closeIdx = matchBracket(tagSrc, braceIdx + 1, '{', '}');
    if (closeIdx < 0) throw new Error(`style object at ${loc} has unbalanced braces`);
    const objSrc = tagSrc.slice(braceIdx + 2, closeIdx);
    const merged = mergeStyleObject(objSrc, styleObj);
    return tagSrc.slice(0, braceIdx + 2) + merged + tagSrc.slice(closeIdx);
  }
  const entries = Object.entries(styleObj)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(String(v))}`).join(', ');
  return tagSrc.replace(/^(<[A-Za-z][A-Za-z0-9]*)/, `$1 style={{ ${entries} }}`);
}

/** 合并 style 对象字面量文本：同 key 覆盖（值重写），其余条目原文保留；新 key 追加 */
function mergeStyleObject(objSrc, styleObj) {
  const parts = splitTopLevel(objSrc, ',').filter((p) => p.trim() !== '');
  const entries = parts.map((p) => {
    const km = /^\s*(?:([A-Za-z_$][\w$-]*)|"([^"]*)"|'([^']*)')\s*:/.exec(p);
    return { key: km ? (km[1] ?? km[2] ?? km[3]) : null, text: p };
  });
  for (const [k, v] of Object.entries(styleObj)) {
    const text = ` ${JSON.stringify(k)}: ${JSON.stringify(String(v))}`;
    const idx = entries.findIndex((e) => e.key === k);
    if (idx >= 0) entries[idx] = { key: k, text };
    else entries.push({ key: k, text });
  }
  const tail = /\s*$/.exec(objSrc)[0]; // 保留对象字面量尾部空白（如 `" }}` 前的空格/换行）
  return entries.map((e) => e.text).join(',') + tail;
}

/** 修改目标元素的文本内容（替换开标签与对应闭合标签之间的纯文本） */
export function patchElementText(code, loc, newText) {
  const pos = findOpeningTag(code, loc);
  if (!pos) throw new Error(`element not found at ${loc}`);
  // 找匹配的闭合标签（考虑同标签嵌套计数）
  const re = new RegExp(`<\\/?${pos.tag}[\\s>/]`, 'g');
  re.lastIndex = pos.end;
  let depth = 1;
  let m;
  while ((m = re.exec(code))) {
    if (m[0][1] === '/') {
      depth--;
      if (depth === 0) {
        // 区间内必须是纯文本（无子元素/表达式）才替换，否则拒绝（Phase 2 AST 再支持复杂场景）
        const inner = code.slice(pos.end, m.index);
        if (/[<{]/.test(inner)) {
          throw new Error(`element at ${loc} has non-text children; text patch unsupported in phase 1`);
        }
        return code.slice(0, pos.end) + String(newText) + code.slice(m.index);
      }
    } else if (!code.slice(m.index, m.index + m[0].length).endsWith('/')) {
      depth++;
    }
  }
  throw new Error(`closing tag for <${pos.tag}> not found at ${loc}`);
}

/* ---- SPEC 接口中 Phase 2 才完整实现的部分：提供可用的最小实现/显式降级 ---- */

/** Phase 1：不做完整 AST parse，返回按行结构（占位，保持接口形状） */
export function parseCode(code) {
  return { type: 'LineBasedFallback', code, note: 'phase 1 fallback; phase 2 uses @babel/parser + recast' };
}

export function serialize(ast) {
  if (ast && ast.type === 'LineBasedFallback') return ast.code;
  throw new Error('serialize: unsupported ast (phase 1 fallback)');
}

/** 验证 loc 是否指向一个真实开标签；是 → loc 信息对象，否 → null */
export function findElementByLoc(code, loc) {
  const pos = findOpeningTag(code, loc);
  return pos ? { loc, tag: pos.tag, start: pos.start, end: pos.end } : null;
}
