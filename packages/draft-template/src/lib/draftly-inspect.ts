import { createAnnotationCard } from "./inspect/annotation-card"
import { readComputedStyles } from "./inspect/style-fields"

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
  uid: string
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

type Entry = {
  locator: SelectionLocator
  comment: string
  styleEdits: Record<string, string>
  // Original inline value for each touched property, so live preview can revert.
  savedStyles: Record<string, string>
  // Only confirmed entries are handed to the editor host as the modification
  // list. A freshly inspected element starts unconfirmed (a local draft) and is
  // discarded on cancel/ESC/exit unless the user explicitly confirms it.
  confirmed: boolean
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

// Persistent selection: preserves DOM element -> entry, in insertion order.
const selection = new Map<Element, Entry>()
const selectionOverlays: HTMLDivElement[] = []
let activeElement: Element | null = null

const card = createAnnotationCard({
  onComment(value) {
    const entry = activeEntry()
    if (!entry) return
    entry.comment = value
    if (entry.confirmed) postSelection()
  },
  onStyle(key, value) {
    if (!activeElement) return
    const entry = activeEntry()
    if (!entry) return
    applyLiveStyle(activeElement, entry, key, value)
    if (entry.confirmed) postSelection()
  },
  onConfirm() {
    // Confirm the current draft: this is the only path that adds the inspected
    // element to the modification list handed to the editor/agent.
    const entry = activeEntry()
    if (entry) entry.confirmed = true
    setActive(null)
    postSelection()
  },
  onClose() {
    // Cancel: an unconfirmed draft is discarded (its live styles reverted) and
    // never enters the modification list. A confirmed element just closes.
    const element = activeElement
    const entry = activeEntry()
    if (element && entry && !entry.confirmed) {
      restoreStyles(element, entry)
      selection.delete(element)
    }
    activeElement = null
    renderSelection()
    postSelection()
  },
  onApplyStyles() {
    // Applying styles is an explicit commit of the current draft too.
    const entry = activeEntry()
    if (entry) entry.confirmed = true
    renderSelection()
    postSelection()
    // Hand the pure-engineering style apply to the editor host.
    window.parent.postMessage({ type: "draftly:apply-styles", token }, parentOrigin)
  },
})

// Once the user drags the card, we pin it: auto-repositioning (scroll/resize/live
// edits) stops moving it so it stays where they put it. Selecting a different
// element re-anchors it (see setActive).
let cardPinned = false
let draggingCard = false
let dragOffsetX = 0
let dragOffsetY = 0

card.el.addEventListener("pointerdown", (event: PointerEvent) => {
  if (event.button !== 0) return
  const target = event.target as HTMLElement | null
  if (!target) return
  // Never start a drag from an interactive control inside the header.
  if (target.closest('button, input, textarea, select, a, [role="button"], [data-slot="select-trigger"]')) return
  if (!target.closest("[data-draftly-drag-handle]")) return
  draggingCard = true
  cardPinned = true
  const rect = card.el.getBoundingClientRect()
  dragOffsetX = event.clientX - rect.left
  dragOffsetY = event.clientY - rect.top
  try {
    card.el.setPointerCapture(event.pointerId)
  } catch {
    // ignore capture errors
  }
  event.preventDefault()
})

card.el.addEventListener("pointermove", (event: PointerEvent) => {
  if (!draggingCard) return
  const margin = 8
  const width = card.el.offsetWidth
  const height = card.el.offsetHeight
  let left = event.clientX - dragOffsetX
  let top = event.clientY - dragOffsetY
  left = Math.min(Math.max(margin, left), window.innerWidth - width - margin)
  top = Math.min(Math.max(margin, top), window.innerHeight - height - margin)
  Object.assign(card.el.style, { left: `${left}px`, top: `${top}px` })
})

function endCardDrag(event: PointerEvent) {
  if (!draggingCard) return
  draggingCard = false
  try {
    card.el.releasePointerCapture(event.pointerId)
  } catch {
    // ignore capture errors
  }
}

card.el.addEventListener("pointerup", endCardDrag)
card.el.addEventListener("pointercancel", endCardDrag)

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

let uidSeq = 0

function uidFor(element: Element): string {
  const el = element as HTMLElement
  if (!el.dataset.draftlyUid) el.dataset.draftlyUid = `u${++uidSeq}`
  return el.dataset.draftlyUid
}

function enrichLocator(element: Element): SelectionLocator | null {
  const locator = locatorFor(element)
  if (!locator) return null
  const style = getComputedStyle(element)
  return {
    ...locator,
    uid: uidFor(element),
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
  if (target?.closest("[data-draftly-card]")) return null
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
    cursor: "pointer",
    pointerEvents: "auto",
  })
  el.append(badge)
  return el
}

function renderSelection() {
  const elements = Array.from(selection.keys())
  while (selectionOverlays.length > elements.length) {
    selectionOverlays.pop()?.remove()
  }
  let confirmedCount = 0
  elements.forEach((element, index) => {
    const entry = selection.get(element)
    if (!entry) return
    let overlay = selectionOverlays[index]
    if (!overlay) {
      overlay = createSelectionOverlay()
      selectionOverlays[index] = overlay
      document.body.append(overlay)
    }
    const rect = element.getBoundingClientRect()
    const isActive = element === activeElement
    const isDraft = !entry.confirmed
    Object.assign(overlay.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      borderColor: isDraft ? "#d97706" : isActive ? "#1d4ed8" : "#2563eb",
      borderStyle: isDraft ? "dashed" : "solid",
      background: isDraft
        ? "rgba(217, 119, 6, 0.12)"
        : isActive
          ? "rgba(37, 99, 235, 0.16)"
          : "rgba(37, 99, 235, 0.08)",
    })
    const badge = overlay.firstElementChild as HTMLElement | null
    if (badge) {
      badge.style.display = "block"
      if (isDraft) {
        badge.textContent = "编辑中"
        badge.style.background = "#d97706"
        badge.style.cursor = "default"
        badge.onclick = null
      } else {
        confirmedCount += 1
        badge.textContent = String(confirmedCount)
        badge.style.background = isActive ? "#1d4ed8" : "#2563eb"
        badge.style.cursor = "pointer"
        badge.onclick = (event) => {
          event.preventDefault()
          event.stopPropagation()
          setActive(element)
        }
      }
    }
  })
  renderCard()
}

function entryTitle(locator: SelectionLocator): string {
  const name = locator.component || locator.jsxName || locator.tagName
  return `${name} · ${locator.file}:${locator.line}`
}

function isComponentTarget(locator: SelectionLocator): boolean {
  return /^[A-Z]/.test(locator.jsxName || "")
}

function activeEntry(): Entry | null {
  if (!activeElement) return null
  return selection.get(activeElement) ?? null
}

function renderCard() {
  const entry = activeEntry()
  if (!activeElement || !entry) {
    card.el.style.display = "none"
    return
  }
  const confirmed = Array.from(selection.values()).filter((e) => e.confirmed).length
  const confirmedIndex = Array.from(selection.entries())
    .filter(([, e]) => e.confirmed)
    .findIndex(([el]) => el === activeElement)
  card.el.style.display = "block"
  card.render({
    // A draft shows the neutral "标注" badge; confirmed entries get their number.
    index: entry.confirmed ? confirmedIndex : 0,
    total: entry.confirmed ? confirmed : 1,
    title: entryTitle(entry.locator),
    isComponent: isComponentTarget(entry.locator),
    comment: entry.comment,
    styleEdits: entry.styleEdits,
    computed: readComputedStyles(activeElement),
  })
  positionCard(activeElement)
}

function positionCard(element: Element) {
  if (cardPinned) return
  const rect = element.getBoundingClientRect()
  const width = card.el.offsetWidth || 292
  const height = card.el.offsetHeight || 320
  const margin = 8
  let top = rect.bottom + margin
  if (top + height > window.innerHeight - margin) {
    top = rect.top - height - margin
  }
  if (top < margin) top = margin
  let left = rect.left
  if (left + width > window.innerWidth - margin) {
    left = window.innerWidth - width - margin
  }
  if (left < margin) left = margin
  Object.assign(card.el.style, { top: `${top}px`, left: `${left}px` })
}

function applyLiveStyle(element: Element, entry: Entry, key: string, rawValue: string) {
  const el = element as HTMLElement
  const value = rawValue.trim()
  const styleMap = el.style as unknown as Record<string, string>
  if (!(key in entry.savedStyles)) {
    entry.savedStyles[key] = styleMap[key] ?? ""
  }
  if (!value) {
    delete entry.styleEdits[key]
    styleMap[key] = entry.savedStyles[key]
    return
  }
  entry.styleEdits[key] = value
  styleMap[key] = value
}

function restoreStyles(element: Element, entry: Entry) {
  const styleMap = (element as HTMLElement).style as unknown as Record<string, string>
  for (const [key, original] of Object.entries(entry.savedStyles)) {
    styleMap[key] = original
  }
  entry.savedStyles = {}
  entry.styleEdits = {}
}

function discardDrafts(except: Element | null) {
  // Drop any unconfirmed drafts we're navigating away from, reverting their
  // live style preview so the page returns to its committed state.
  for (const [element, entry] of Array.from(selection)) {
    if (!entry.confirmed && element !== except) {
      restoreStyles(element, entry)
      selection.delete(element)
      if (activeElement === element) activeElement = null
    }
  }
}

function setActive(element: Element | null) {
  const next = element && selection.has(element) ? element : null
  discardDrafts(next)
  // Re-anchor the card to a freshly focused element (drop any manual drag pin).
  if (next && next !== activeElement) cardPinned = false
  activeElement = next
  renderSelection()
}

function removeSelection(element: Element) {
  const entry = selection.get(element)
  if (entry) restoreStyles(element, entry)
  selection.delete(element)
  if (activeElement === element) {
    const remaining = Array.from(selection.keys())
    activeElement = remaining[remaining.length - 1] || null
  }
  renderSelection()
  postSelection()
}

function postSelection() {
  // Only confirmed entries are part of the modification list the editor sees.
  const elements = Array.from(selection.entries()).filter(([, entry]) => entry.confirmed)
  const confirmedElements = elements.map(([element]) => element)
  const activeConfirmed = Boolean(activeElement && selection.get(activeElement)?.confirmed)
  window.parent.postMessage(
    {
      type: "draftly:selection",
      token,
      activeIndex: activeConfirmed ? confirmedElements.indexOf(activeElement as Element) : -1,
      locators: elements.map(([, entry]) => ({
        ...entry.locator,
        comment: entry.comment,
        styleEdits: { ...entry.styleEdits },
      })),
    },
    parentOrigin,
  )
}

function clearSelection(notify: boolean) {
  for (const [element, entry] of selection) restoreStyles(element, entry)
  selection.clear()
  activeElement = null
  renderSelection()
  if (notify) postSelection()
}

function locatorMatches(
  locator: SelectionLocator,
  ref: { uid?: string; file?: string; line?: number; column?: number },
) {
  if (ref.uid != null) return locator.uid === ref.uid
  return (
    locator.file === ref.file &&
    locator.line === ref.line &&
    (ref.column == null || locator.column === ref.column)
  )
}

function findByRef(ref: { uid?: string; file?: string; line?: number; column?: number }): Element | null {
  for (const [element, entry] of selection) {
    if (locatorMatches(entry.locator, ref)) return element
  }
  return null
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return
  if (event.data?.type === "draftly:navigate") {
    if (event.data.action === "back") window.history.back()
    if (event.data.action === "forward") window.history.forward()
    return
  }
  if (event.data?.type === "draftly:deselect") {
    const element = findByRef(event.data)
    if (element) removeSelection(element)
    return
  }
  if (event.data?.type === "draftly:set-active") {
    const element = findByRef(event.data)
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" })
      setActive(element)
    }
    return
  }
  if (event.data?.type === "draftly:update-annotation") {
    const element = findByRef(event.data)
    const entry = element && selection.get(element)
    if (entry) {
      entry.comment = String(event.data.comment ?? "")
      if (element === activeElement) renderCard()
    }
    return
  }
  if (event.data?.type === "draftly:reset-styles") {
    for (const [element, entry] of selection) restoreStyles(element, entry)
    renderCard()
    return
  }
  if (event.data?.type === "draftly:clear-selection") {
    clearSelection(false)
    return
  }
  if (event.data?.type === "draftly:discard-drafts") {
    // Leave annotation mode without touching confirmed elements: drop the
    // in-progress draft (if any) and close the card, keep confirmed overlays.
    discardDrafts(null)
    activeElement = null
    placeHover(null)
    renderSelection()
    postSelection()
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
  const existing = selection.get(element)
  if (existing) {
    if (!existing.confirmed) {
      // Clicking the current draft again cancels it (nothing gets committed).
      removeSelection(element)
      return
    }
    // A confirmed element reopens for a second edit ("二次修改").
    setActive(element)
    return
  }
  const locator = enrichLocator(element)
  if (!locator) return
  // Start a local draft. It is NOT part of the modification list until the user
  // confirms it; picking another element first discards this draft (setActive).
  selection.set(element, {
    locator,
    comment: "",
    styleEdits: {},
    savedStyles: {},
    confirmed: false,
  })
  placeHover(null)
  setActive(element)
}, true)

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return
  if (!enabled && selection.size === 0) return
  const hasDraft = Array.from(selection.values()).some((entry) => !entry.confirmed)
  if (hasDraft) {
    // First ESC cancels the in-progress inspection without adding it and keeps
    // inspect mode + already-confirmed elements intact.
    placeHover(null)
    discardDrafts(null)
    renderSelection()
    postSelection()
    return
  }
  // No draft: leave annotation mode but keep confirmed elements queued. The host
  // turns off picking (crosshair) via the escape message; overlays stay put.
  placeHover(null)
  activeElement = null
  renderSelection()
  window.parent.postMessage({ type: "draftly:escape", token }, parentOrigin)
}, true)

function reposition() {
  if (selection.size > 0) renderSelection()
}
window.addEventListener("scroll", reposition, true)
window.addEventListener("resize", reposition)

document.addEventListener("DOMContentLoaded", () => {
  document.body.append(hoverOverlay)
  document.body.append(card.el)
  window.parent.postMessage({ type: "draftly:ready" }, "*")
})

export {}
