type LocatorExpression = {
  name?: string
  loc?: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
  wrappingComponentId?: number | null
}

type LocatorFile = {
  filePath: string
  projectPath: string
  expressions: LocatorExpression[]
  components: Array<{ name?: string }>
}

declare global {
  interface Window {
    __LOCATOR_DATA__?: Record<string, LocatorFile>
  }
}

const overlay = document.createElement("div")
overlay.dataset.draftlyInspectOverlay = "true"
Object.assign(overlay.style, {
  position: "fixed",
  pointerEvents: "none",
  border: "2px solid #2563eb",
  background: "rgba(37, 99, 235, 0.08)",
  display: "none",
  zIndex: "2147483647",
})

let enabled = false
let token = ""
let parentOrigin = "*"

function locatorFor(element: Element) {
  const rawId = element.getAttribute("data-locatorjs-id")
  if (!rawId) return null
  const separator = rawId.lastIndexOf("::")
  if (separator < 0) return null
  const fileKey = rawId.slice(0, separator)
  const expressionId = Number.parseInt(rawId.slice(separator + 2), 10)
  const file = window.__LOCATOR_DATA__?.[fileKey]
  const expression = file?.expressions?.[expressionId]
  if (!file || !expression?.loc) return null
  const component = expression.wrappingComponentId == null
    ? null
    : file.components?.[expression.wrappingComponentId]?.name || null
  return {
    file: file.filePath.replace(/^[/\\]+/, ""),
    line: expression.loc.start.line,
    column: expression.loc.start.column,
    endLine: expression.loc.end.line,
    endColumn: expression.loc.end.column,
    component,
    jsxName: expression.name || element.tagName.toLowerCase(),
  }
}

function targetAt(event: Event) {
  const target = event.target instanceof Element ? event.target : null
  return target?.closest("[data-locatorjs-id]") || null
}

function placeOverlay(element: Element | null) {
  if (!enabled || !element) {
    overlay.style.display = "none"
    return
  }
  const rect = element.getBoundingClientRect()
  Object.assign(overlay.style, {
    display: "block",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  })
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return
  if (event.data?.type === "draftly:navigate") {
    if (event.data.action === "back") window.history.back()
    if (event.data.action === "forward") window.history.forward()
    return
  }
  if (event.data?.type !== "draftly:inspect") return
  enabled = Boolean(event.data.enabled)
  token = String(event.data.token || "")
  parentOrigin = event.origin
  document.documentElement.style.cursor = enabled ? "crosshair" : ""
  if (!enabled) placeOverlay(null)
})

document.addEventListener("pointermove", (event) => {
  if (enabled) placeOverlay(targetAt(event))
}, true)

document.addEventListener("click", (event) => {
  if (!enabled) return
  const element = targetAt(event)
  const locator = element ? locatorFor(element) : null
  if (!element || !locator) return
  event.preventDefault()
  event.stopPropagation()
  const style = getComputedStyle(element)
  window.parent.postMessage({
    type: "draftly:selection",
    token,
    locator: {
      ...locator,
      tagName: element.tagName.toLowerCase(),
      text: (element.textContent || "").trim().slice(0, 240),
      ancestry: Array.from(element.parentElement?.children || []).indexOf(element),
      styles: {
        display: style.display,
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontSize: style.fontSize,
      },
    },
  }, parentOrigin)
}, true)

document.addEventListener("DOMContentLoaded", () => {
  document.body.append(overlay)
  window.parent.postMessage({ type: "draftly:ready" }, "*")
})

export {}
