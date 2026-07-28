/**
 * inspect.js — Inspect 模式消息协议（Phase 2，SPEC 2.3）。
 * preview-server 注入 /__inspect.js；iframe 内脚本与编辑器父窗口经 postMessage 通信。
 * 本模块为协议单一事实来源：编辑器（/shared/inspect.js）与 server 测试共用。
 *
 * 消息：
 *   父 → iframe: { type: 'draftly:inspect:set', enabled: boolean }
 *   iframe → 父: { type: 'draftly:inspect:select', payload: SelectPayload }
 * SelectPayload = { loc, tagName, className, textContent, computedStyles }
 *   computedStyles 仅含 COMPUTED_STYLE_KEYS 列出的关键项（字符串值）。
 */

export const INSPECT_MSG_SET = 'draftly:inspect:set';
export const INSPECT_MSG_SELECT = 'draftly:inspect:select';
export const INSPECT_PROTOCOL_VERSION = 2;

/** 回传的关键 computed style 项（与注入脚本保持一致） */
export const COMPUTED_STYLE_KEYS = [
  'color', 'fontSize', 'fontFamily', 'backgroundColor',
  'borderRadius', 'padding', 'margin',
];

/**
 * 校验 select payload，返回错误列表（空数组 = 通过）。
 * @param {any} p
 * @returns {string[]}
 */
export function validateSelectPayload(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return ['payload must be an object'];
  if (typeof p.loc !== 'string' || !/^.+:\d+:\d+$/.test(p.loc)) {
    errors.push('loc must be "file:line:col"');
  }
  if (typeof p.tagName !== 'string' || !p.tagName) errors.push('tagName must be a non-empty string');
  if (typeof p.className !== 'string') errors.push('className must be a string');
  if (typeof p.textContent !== 'string') errors.push('textContent must be a string');
  if (!p.computedStyles || typeof p.computedStyles !== 'object' || Array.isArray(p.computedStyles)) {
    errors.push('computedStyles must be an object');
  } else {
    for (const [k, v] of Object.entries(p.computedStyles)) {
      if (!COMPUTED_STYLE_KEYS.includes(k)) errors.push(`computedStyles: unexpected key "${k}"`);
      if (typeof v !== 'string') errors.push(`computedStyles.${k} must be a string`);
    }
  }
  return errors;
}

/**
 * 校验完整消息信封 { type, payload }。
 * @param {any} msg postMessage 的 data
 * @returns {boolean}
 */
export function validateSelectMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.type !== INSPECT_MSG_SELECT) return false;
  return validateSelectPayload(msg.payload).length === 0;
}

/**
 * 解析 postMessage data：合法 → payload；非法/非本协议 → null（调用方安全忽略）。
 * @param {any} data
 * @returns {object|null}
 */
export function parseSelectMessage(data) {
  return validateSelectMessage(data) ? data.payload : null;
}

/** 校验 set 控制消息（父 → iframe） */
export function validateSetMessage(msg) {
  return !!msg && typeof msg === 'object' && msg.type === INSPECT_MSG_SET && typeof msg.enabled === 'boolean';
}
