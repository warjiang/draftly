import type * as t from '@babel/types';
import { findSmallestJsxAt, parseSource } from './source-locator.js';
import type { ErrorWithStatus } from './types.js';

// React inline-style keys the annotation panel is allowed to write. Keeping the
// list explicit (and every key a valid JS identifier) keeps the source rewrite
// deterministic and blocks arbitrary attribute injection.
export const ALLOWED_STYLE_PROPERTIES = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'padding',
  'margin',
  'borderRadius',
  'display',
] as const;

export type StyleProperty = (typeof ALLOWED_STYLE_PROPERTIES)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_STYLE_PROPERTIES);
// Permit lengths, colors, keywords, and simple shorthands. Reject characters
// that could break out of the string literal or the JSX expression.
const VALUE_PATTERN = /^[-#%.,()a-zA-Z0-9\s/]+$/;
const MAX_VALUE_LENGTH = 64;

export type StyleEdit = {
  file: string;
  line: number;
  column: number;
  styles: Record<string, string>;
};

function badRequest(message: string): ErrorWithStatus {
  const error = new Error(message) as ErrorWithStatus;
  error.status = 400;
  return error;
}

export function sanitizeStyleMap(styles: unknown): Record<StyleProperty, string> {
  if (!styles || typeof styles !== 'object') {
    throw badRequest('style map required');
  }
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(styles as Record<string, unknown>)) {
    if (!ALLOWED_SET.has(key)) {
      throw badRequest(`unsupported style property: ${key}`);
    }
    const value = String(raw ?? '').trim();
    if (!value) continue;
    if (value.length > MAX_VALUE_LENGTH || !VALUE_PATTERN.test(value)) {
      throw badRequest(`invalid style value for ${key}`);
    }
    result[key] = value;
  }
  return result as Record<StyleProperty, string>;
}

function objectExpressionFromStyleAttr(
  attr: t.JSXAttribute,
): t.ObjectExpression | null {
  const value = attr.value;
  if (
    value?.type === 'JSXExpressionContainer' &&
    value.expression.type === 'ObjectExpression'
  ) {
    return value.expression;
  }
  return null;
}

function propertyKeyName(property: t.ObjectProperty): string | null {
  const key = property.key;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'StringLiteral') return key.value;
  return null;
}

type Replacement = { start: number; end: number; text: string };

function serializeValue(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

function serializeStyleObjectBody(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([key, value]) => `${key}: ${serializeValue(value)}`)
    .join(', ');
}

/**
 * Merge inline style edits into the JSX element at the given position. Uses
 * targeted text slicing so only the touched `style` object is reformatted and
 * the rest of the file (spacing, comments, unrelated attributes) is preserved.
 */
function editAt(
  source: string,
  edit: { line: number; column: number; styles: Record<string, string> },
): Replacement {
  const ast = parseSource(source);
  const target = findSmallestJsxAt(ast, edit.line, edit.column);
  if (!target) {
    throw badRequest(
      `source element not found at ${edit.line}:${edit.column}`,
    );
  }
  if (target.node.type !== 'JSXElement') {
    throw badRequest('cannot apply inline style to a fragment');
  }
  const opening = target.node.openingElement;
  const styleAttr = opening.attributes.find(
    (attribute): attribute is t.JSXAttribute =>
      attribute.type === 'JSXAttribute' &&
      attribute.name.type === 'JSXIdentifier' &&
      attribute.name.name === 'style',
  );

  if (!styleAttr) {
    const insertAt = opening.name.end ?? 0;
    const body = serializeStyleObjectBody(edit.styles);
    return { start: insertAt, end: insertAt, text: ` style={{ ${body} }}` };
  }

  const objectExpression = objectExpressionFromStyleAttr(styleAttr);
  if (!objectExpression) {
    // Non-object style (e.g. a variable). Wrap it with a spread so existing
    // values survive and our edits win.
    const start = styleAttr.start ?? 0;
    const end = styleAttr.end ?? 0;
    const original = styleAttr.value;
    let spread = '';
    if (original?.type === 'JSXExpressionContainer') {
      spread = source.slice(
        original.expression.start ?? 0,
        original.expression.end ?? 0,
      );
    }
    const body = serializeStyleObjectBody(edit.styles);
    const text = spread
      ? `style={{ ...(${spread}), ${body} }}`
      : `style={{ ${body} }}`;
    return { start, end, text };
  }

  const remaining = { ...edit.styles };
  const inner: Replacement[] = [];
  for (const property of objectExpression.properties) {
    if (property.type !== 'ObjectProperty') continue;
    const name = propertyKeyName(property);
    if (name == null || !(name in remaining)) continue;
    const value = property.value;
    inner.push({
      start: value.start ?? 0,
      end: value.end ?? 0,
      text: serializeValue(remaining[name]),
    });
    delete remaining[name];
  }

  const appendKeys = Object.keys(remaining);
  const hadExisting = objectExpression.properties.length > 0;
  const objectStart = objectExpression.start ?? 0;
  const objectEnd = objectExpression.end ?? 0;
  let text = source.slice(objectStart, objectEnd);
  // Apply inner value replacements back-to-front against the object slice.
  const relative = inner
    .map((item) => ({
      start: item.start - objectStart,
      end: item.end - objectStart,
      text: item.text,
    }))
    .sort((a, b) => b.start - a.start);
  for (const item of relative) {
    text = text.slice(0, item.start) + item.text + text.slice(item.end);
  }
  if (appendKeys.length) {
    const additions = serializeStyleObjectBody(
      Object.fromEntries(appendKeys.map((key) => [key, remaining[key]])),
    );
    const closing = text.lastIndexOf('}');
    const before = text.slice(0, closing).replace(/\s+$/, '');
    const needsComma = hadExisting && !before.endsWith('{');
    text = `${before}${needsComma ? ',' : ''} ${additions} ${text.slice(closing)}`;
  }
  return { start: objectStart, end: objectEnd, text };
}

/**
 * Apply one or more style edits (all targeting the same file's source) and
 * return the rewritten source. Edits are applied from the end of the file
 * backwards so earlier offsets stay valid.
 */
export function applyStyleEditsToSource(
  source: string,
  edits: Array<{ line: number; column: number; styles: Record<string, string> }>,
): string {
  const replacements = edits
    .filter((edit) => Object.keys(edit.styles).length > 0)
    .map((edit) => editAt(source, edit))
    .sort((a, b) => b.start - a.start);
  if (!replacements.length) return source;
  // Guard against overlapping targets (e.g. nested selected elements sharing a
  // style attribute); applying overlapping slices would corrupt the source.
  for (let i = 1; i < replacements.length; i += 1) {
    if (replacements[i].end > replacements[i - 1].start) {
      throw badRequest('overlapping style edits are not supported');
    }
  }
  let result = source;
  for (const replacement of replacements) {
    result =
      result.slice(0, replacement.start) +
      replacement.text +
      result.slice(replacement.end);
  }
  return result;
}
