const FALLBACK_COLORS = {
  background: "#f7f7f5",
  surface: "#ffffff",
  primary: "#18181b",
  text: "#18181b",
  muted: "#71717a",
  border: "#e4e4e7",
  accent: "#f1f1f0",
  destructive: "#b42318",
};

function valueOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function colorOr(value, fallback) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value || "")
    ? value
    : fallback;
}

function readableOn(hex) {
  const normalized = hex.slice(1);
  const expanded = normalized.length <= 4
    ? normalized.slice(0, 3).split("").map((character) => character + character).join("")
    : normalized.slice(0, 6);
  const [red, green, blue] = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? "#18181b" : "#ffffff";
}

function fontFamilyOr(value) {
  const fontFamily = valueOr(value, '"Geist Variable", sans-serif');
  const missingOpeningQuote = /^([^"]+)",\s*(.+)$/.exec(fontFamily);
  return missingOpeningQuote
    ? `"${missingOpeningQuote[1]}", ${missingOpeningQuote[2]}`
    : fontFamily;
}

export function buildDesignPreviewStyle(meta = {}) {
  const colors = Object.fromEntries(
    Object.entries(FALLBACK_COLORS).map(([key, fallback]) => [
      key,
      colorOr(meta.colors?.[key], fallback),
    ]),
  );
  const radius = meta.radius || {};
  const typography = meta.typography || {};
  const scale = typography.scale || {};
  const shadows = meta.shadows || {};
  const motion = meta.motion || {};

  return {
    "--design-background": colors.background,
    "--design-surface": colors.surface,
    "--design-primary": colors.primary,
    "--design-on-primary": readableOn(colors.primary),
    "--design-text": colors.text,
    "--design-muted": colors.muted,
    "--design-border": colors.border,
    "--design-accent": colors.accent,
    "--design-destructive": colors.destructive,
    "--design-font": fontFamilyOr(typography.fontFamily),
    "--design-h1": valueOr(scale.h1, "48px"),
    "--design-h2": valueOr(scale.h2, "30px"),
    "--design-body": valueOr(scale.body, "16px"),
    "--design-small": valueOr(scale.small, "13px"),
    "--design-radius-sm": valueOr(radius.sm, "6px"),
    "--design-radius-md": valueOr(radius.md, "10px"),
    "--design-radius-full": valueOr(radius.full, "999px"),
    "--design-shadow-sm": valueOr(shadows.sm, "0 1px 2px rgba(0,0,0,0.08)"),
    "--design-shadow-md": valueOr(shadows.md, "0 16px 38px rgba(0,0,0,0.12)"),
    "--design-duration": valueOr(motion.duration, "180ms"),
    "--design-easing": valueOr(motion.easing, "ease-out"),
  };
}

export function designPreviewName(meta = {}, fallback = "Design system") {
  return valueOr(meta.name, fallback);
}
