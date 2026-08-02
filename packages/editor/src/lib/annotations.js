// Pure helpers for working with in-preview annotations. Kept framework-free so
// they are easy to unit test independently of React state.

// React inline-style keys the annotation panel edits. Mirrors the server's
// ALLOWED_STYLE_PROPERTIES whitelist.
export const STYLE_KEYS = [
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "padding",
  "margin",
  "borderRadius",
  "display",
];

const STYLE_KEY_SET = new Set(STYLE_KEYS);
// Bare numbers get a px unit; these keys are unitless.
const UNITLESS = new Set(["fontWeight", "display"]);

/** Normalize a single style value: trim, drop empties, append px to bare numbers. */
export function normalizeStyleValue(key, value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (!UNITLESS.has(key) && /^-?\d*\.?\d+$/.test(trimmed)) {
    return `${trimmed}px`;
  }
  return trimmed;
}

/** Normalize a style edit map, keeping only whitelisted keys with non-empty values. */
export function normalizeStyleEdits(styleEdits) {
  const result = {};
  for (const [key, value] of Object.entries(styleEdits || {})) {
    if (!STYLE_KEY_SET.has(key)) continue;
    const normalized = normalizeStyleValue(key, value);
    if (normalized) result[key] = normalized;
  }
  return result;
}

/** True when an annotation carries at least one style change. */
export function hasStyleEdits(annotation) {
  return Object.keys(normalizeStyleEdits(annotation?.styleEdits)).length > 0;
}

/** Count style changes across a selection. */
export function countStyleEdits(annotation) {
  return Object.keys(normalizeStyleEdits(annotation?.styleEdits)).length;
}

/** True when any annotation in the list carries a style change. */
export function selectionHasStyleEdits(selected) {
  return (selected || []).some(hasStyleEdits);
}

/** True when any annotation carries a non-empty comment. */
export function selectionHasComments(selected) {
  return (selected || []).some((item) => item?.comment?.trim());
}

/**
 * Build the payload for POST /api/drafts/:id/apply-style: one entry per
 * annotation that has style changes, keyed by source location.
 */
export function buildStyleEditPayload(selected) {
  return (selected || [])
    .map((item) => ({
      file: item.file,
      line: item.line,
      column: item.column,
      styles: normalizeStyleEdits(item.styleEdits),
    }))
    .filter((edit) => Object.keys(edit.styles).length > 0);
}

/** Stable identity for an annotation, used for React keys and equality. */
export function annotationKey(item) {
  if (item?.uid) return item.uid;
  return `${item.file}:${item.line}:${item.column}`;
}

/** Whether two annotations point at the same source location. */
export function sameAnnotation(a, b) {
  return Boolean(a) && Boolean(b) && annotationKey(a) === annotationKey(b);
}
