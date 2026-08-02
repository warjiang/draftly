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

type SelectionLocator = {
  file: string
  line: number
  column: number
  endLine: number
  endColumn: number
  component: string | null
  jsxName: string
  tagName: string
  text: string
  ancestry: number
  styles: {
    display: string
    color: string
    backgroundColor: string
    fontSize: string
  }
}

declare global {
  interface Window {
    __LOCATOR_DATA__?: Record<string, LocatorFile>
  }
}

const hoverOverlay = document.createElement("div")
hoverOverlay.dataset.draftlyInspectOverlay = "true"
Object.assign(hoverOverlay.style, {
  position: "fixed",
  pointerEvents: "none",
  border: "2px dashed #2563eb",
  background: "rgba(37, 99, 235, 0.06)",
  display: "none",
  zIndex: "2147483646",
})

let enabled = false
let token = ""
let parentOrigin = "*"

// Persistent selection: preserves DOM element -> locator, in insertion order.
const selection = new Map<Element, SelectionLocator>()
const selectionOverlays: HTMLDivElement[] = []

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

function enrichLocator(element: Element): SelectionLocator | null {
  const locator = locatorFor(element)
  if (!locator) return null
  const style = getComputedStyle(element)
  return {
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
  }
}

function targetAt(event: Event) {
  const target = event.target instanceof Element ? event.target : null
  return target?.closest("[data-locatorjs-id]") || null
}

function placeHover(element: Element | null) {
  if (!enabled || !element || selection.has(element)) {
    hoverOverlay.style.display = "none"
    return
  }
  const rect = element.getBoundingClientRect()
  Object.assign(hoverOverlay.style, {
    display: "block",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  })
}

function createSelectionOverlay(): HTMLDivElement {
  const el = document.createElement("div")
  el.dataset.draftlySelectionOverlay = "true"
  Object.assign(el.style, {
    position: "fixed",
    pointerEvents: "none",
    border: "2px solid #2563eb",
    background: "rgba(37, 99, 235, 0.12)",
    display: "none",
    zIndex: "2147483645",
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.6)",
    borderRadius: "2px",
  })
  const badge = document.createElement("span")
  badge.dataset.draftlyBadge = "true"
  Object.assign(badge.style, {
    position: "absolute",
    top: "-10px",
    left: "-10px",
    minWidth: "18px",
    height: "18px",
    padding: "0 5px",
    borderRadius: "9px",
    background: "#2563eb",
    color: "#fff",
    fontSize: "11px",
    lineHeight: "18px",
    fontWeight: "600",
    textAlign: "center",
    fontFamily: "system-ui, sans-serif",
    boxSizing: "border-box",
  })
  el.append(badge)
  return el
}

function renderSelection() {
  const elements = Array.from(selection.keys())
  while (selectionOverlays.length > elements.length) {
    selectionOverlays.pop()?.remove()
  }
  elements.forEach((element, index) => {
    let overlay = selectionOverlays[index]
    if (!overlay) {
      overlay = createSelectionOverlay()
      selectionOverlays[index] = overlay
      document.body.append(overlay)
    }
    const rect = element.getBoundingClientRect()
    Object.assign(overlay.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    const badge = overlay.firstElementChild as HTMLElement | null
    if (badge) {
      badge.textContent = String(index + 1)
      // Only show numbered badges when there is more than one selection.
      badge.style.display = elements.length > 1 ? "block" : "none"
    }
  })
}

function postSelection() {
  window.parent.postMessage(
    {
      type: "draftly:selection",
      token,
      locators: Array.from(selection.values()),
    },
    parentOrigin,
  )
}

function clearSelection(notify: boolean) {
  selection.clear()
  renderSelection()
  if (notify) postSelection()
}

function locatorMatches(
  locator: SelectionLocator,
  ref: { file?: string; line?: number; column?: number },
) {
  return (
    locator.file === ref.file &&
    locator.line === ref.line &&
    (ref.column == null || locator.column === ref.column)
  )
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return
  if (event.data?.type === "draftly:navigate") {
    if (event.data.action === "back") window.history.back()
    if (event.data.action === "forward") window.history.forward()
    return
  }
  if (event.data?.type === "draftly:deselect") {
    for (const [element, locator] of selection) {
      if (locatorMatches(locator, event.data)) {
        selection.delete(element)
        break
      }
    }
    renderSelection()
    postSelection()
    return
  }
  if (event.data?.type === "draftly:clear-selection") {
    clearSelection(false)
    return
  }
  if (event.data?.type !== "draftly:inspect") return
  enabled = Boolean(event.data.enabled)
  token = String(event.data.token || "")
  parentOrigin = event.origin
  document.documentElement.style.cursor = enabled ? "crosshair" : ""
  if (enabled) {
    // Take keyboard focus so the iframe's own Escape handler fires even when
    // the pointer is inside the preview (cross-origin parents can't observe it).
    try {
      window.focus()
    } catch {
      // ignore focus errors
    }
  } else {
    placeHover(null)
  }
})

document.addEventListener("pointerdown", () => {
  if (enabled) {
    try {
      window.focus()
    } catch {
      // ignore focus errors
    }
  }
}, true)

document.addEventListener("pointermove", (event) => {
  if (enabled) placeHover(targetAt(event))
}, true)

document.addEventListener("click", (event) => {
  if (!enabled) return
  const element = targetAt(event)
  if (!element) return
  event.preventDefault()
  event.stopPropagation()
  const additive = event.metaKey || event.ctrlKey || event.shiftKey
  if (additive && selection.has(element)) {
    selection.delete(element)
  } else {
    const locator = enrichLocator(element)
    if (!locator) return
    if (!additive) selection.clear()
    selection.set(element, locator)
  }
  placeHover(null)
  renderSelection()
  postSelection()
}, true)

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return
  if (!enabled && selection.size === 0) return
  placeHover(null)
  clearSelection(false)
  window.parent.postMessage({ type: "draftly:escape", token }, parentOrigin)
}, true)

function reposition() {
  if (selection.size > 0) renderSelection()
}
window.addEventListener("scroll", reposition, true)
window.addEventListener("resize", reposition)

document.addEventListener("DOMContentLoaded", () => {
  document.body.append(hoverOverlay)
  window.parent.postMessage({ type: "draftly:ready" }, "*")
})

export {}
