// Style controls exposed by the in-preview annotation card. Keys are React
// inline-style properties (camelCase) so they map 1:1 to what the server writes
// into `style={{ ... }}` and to `element.style[key]` for live preview.

export type StyleFieldType = "color" | "text" | "select"

export type StyleField = {
  key: string
  label: string
  type: StyleFieldType
  placeholder?: string
  options?: string[]
}

export const STYLE_FIELDS: StyleField[] = [
  { key: "color", label: "文字颜色", type: "color" },
  { key: "backgroundColor", label: "背景色", type: "color" },
  { key: "fontSize", label: "字号", type: "text", placeholder: "如 16px" },
  {
    key: "fontWeight",
    label: "字重",
    type: "select",
    options: ["", "normal", "500", "600", "700", "bold"],
  },
  { key: "padding", label: "内边距", type: "text", placeholder: "如 8px 12px" },
  { key: "margin", label: "外边距", type: "text", placeholder: "如 0 auto" },
  { key: "borderRadius", label: "圆角", type: "text", placeholder: "如 8px" },
  {
    key: "display",
    label: "显示",
    type: "select",
    options: ["", "block", "inline-block", "flex", "inline-flex", "grid", "none"],
  },
]

const HEX = (n: number) => n.toString(16).padStart(2, "0")

/** Convert a computed `rgb()/rgba()` string to `#rrggbb` for a native color input. */
export function rgbToHex(value: string): string {
  const match = value.match(/rgba?\(([^)]+)\)/i)
  if (!match) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim()) ? value.trim() : "#000000"
  }
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()))
  const [r, g, b] = parts
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return "#000000"
  return `#${HEX(Math.round(r))}${HEX(Math.round(g))}${HEX(Math.round(b))}`
}

const READABLE_KEYS = STYLE_FIELDS.map((field) => field.key)

/** Read the subset of computed styles the card can edit, for a given element. */
export function readComputedStyles(element: Element): Record<string, string> {
  const computed = getComputedStyle(element)
  const result: Record<string, string> = {}
  for (const key of READABLE_KEYS) {
    const value = (computed as unknown as Record<string, string>)[key]
    if (value) result[key] = value
  }
  return result
}
