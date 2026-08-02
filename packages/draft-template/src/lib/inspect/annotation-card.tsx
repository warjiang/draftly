import { useState } from "react"
import { createRoot } from "react-dom/client"
import { STYLE_FIELDS, rgbToHex, type StyleField } from "./style-fields"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

export type CardHandlers = {
  onComment: (value: string) => void
  onStyle: (key: string, value: string) => void
  onConfirm: () => void
  onClose: () => void
  onApplyStyles: () => void
}

export type CardEntry = {
  index: number
  total: number
  title: string
  isComponent: boolean
  comment: string
  styleEdits: Record<string, string>
  computed: Record<string, string>
}

const CARD_STYLE_ID = "draftly-annotation-card-style"
const SELECT_MARKER = "draftly-annotation-select"

// The card renders shadcn components, which read their colors from CSS
// variables. Left alone they would inherit the *host* site's theme — and user
// sites use wildly varying, sometimes unreadable palettes. So we pin a fixed,
// self-contained light theme onto the card root (and the Base UI select popup,
// which portals to <body> outside the card) so it is always legible and clearly
// separated from whatever the page looks like. The select popup also portals
// under the document stacking context, so we lift it above the card here too.
const CARD_THEME = `
color-scheme: light;
--radius: 0.65rem;
--background: #ffffff;
--foreground: #0f172a;
--card: #ffffff;
--card-foreground: #0f172a;
--popover: #ffffff;
--popover-foreground: #0f172a;
--primary: #2563eb;
--primary-foreground: #f8fafc;
--secondary: #f1f5f9;
--secondary-foreground: #0f172a;
--muted: #f1f5f9;
--muted-foreground: #64748b;
--accent: #eff6ff;
--accent-foreground: #1e3a8a;
--destructive: #ef4444;
--border: #e2e8f0;
--input: #cbd5e1;
--ring: #93c5fd;
`

function ensureCardStyle(): void {
  if (document.getElementById(CARD_STYLE_ID)) return
  const style = document.createElement("style")
  style.id = CARD_STYLE_ID
  style.textContent = [
    `[data-draftly-card],[data-slot="select-content"].${SELECT_MARKER}{${CARD_THEME}}`,
    `div:has(> [data-slot="select-content"].${SELECT_MARKER}){z-index:2147483647!important}`,
  ].join("")
  document.head.append(style)
}

function StyleControl({
  field,
  value,
  fallback,
  onChange,
}: {
  field: StyleField
  value: string
  fallback: string
  onChange: (value: string) => void
}) {
  if (field.type === "select") {
    return (
      <Select value={value} onValueChange={(next) => onChange(String(next ?? ""))}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue placeholder="默认" />
        </SelectTrigger>
        <SelectContent className={SELECT_MARKER} data-draftly-card="true">
          {(field.options ?? []).map((option) => (
            <SelectItem key={option || "__default__"} value={option}>
              {option === "" ? "默认" : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === "color") {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={rgbToHex(value || fallback)}
          onChange={(event) => onChange(event.target.value)}
          className="size-8 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0"
          aria-label={`${field.label}取色`}
        />
        <Input
          value={value}
          placeholder={fallback}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 flex-1"
        />
      </div>
    )
  }

  return (
    <Input
      value={value}
      placeholder={field.placeholder || fallback}
      onChange={(event) => onChange(event.target.value)}
      className="h-8"
    />
  )
}

function AnnotationCard({
  entry,
  handlers,
}: {
  entry: CardEntry
  handlers: CardHandlers
}) {
  const [comment, setComment] = useState(entry.comment)
  const [styles, setStyles] = useState<Record<string, string>>({ ...entry.styleEdits })

  const setStyle = (key: string, next: string) => {
    setStyles((prev) => {
      const merged = { ...prev }
      if (next.trim()) merged[key] = next
      else delete merged[key]
      return merged
    })
    handlers.onStyle(key, next)
  }

  const styleCount = Object.keys(styles).length

  return (
    <Card className="w-full gap-0 py-0 shadow-2xl">
      <CardHeader
        data-draftly-drag-handle="true"
        className="flex flex-row items-center gap-2 px-3 py-2.5 cursor-move select-none"
        style={{ touchAction: "none" }}
      >
        <Badge className="shrink-0">
          {entry.total > 1 ? `${entry.index + 1}/${entry.total}` : "标注"}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={entry.title}>
          {entry.title}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          title="取消标注"
          onClick={() => handlers.onClose()}
        >
          <span className="text-base leading-none">×</span>
        </Button>
      </CardHeader>
      <Separator />
      <CardContent className="flex flex-col gap-3 px-3 py-3">
        {entry.isComponent ? (
          <Alert className="py-2">
            <AlertDescription className="text-xs leading-relaxed">
              该目标是组件，内联样式可能不生效，可改用下方备注让 AI 修改。
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">修改说明（交给 AI 时使用）</Label>
          <Textarea
            value={comment}
            rows={2}
            placeholder="描述这个元素要怎么改…"
            className="resize-y text-sm"
            onChange={(event) => {
              setComment(event.target.value)
              handlers.onComment(event.target.value)
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-xs">样式（实时预览，可直接应用）</Label>
          <div className="grid grid-cols-2 gap-x-2 gap-y-2.5">
            {STYLE_FIELDS.map((field) => (
              <div key={field.key} className="flex flex-col gap-1">
                <Label className="text-[11px] font-medium text-muted-foreground">
                  {field.label}
                </Label>
                <StyleControl
                  field={field}
                  value={styles[field.key] ?? ""}
                  fallback={entry.computed[field.key] ?? ""}
                  onChange={(next) => setStyle(field.key, next)}
                />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
      <Separator />
      <div className="flex items-center justify-end gap-2 px-3 py-2.5">
        {styleCount ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handlers.onApplyStyles()}
          >
            应用样式（{styleCount}）
          </Button>
        ) : null}
        <Button type="button" size="sm" onClick={() => handlers.onConfirm()}>
          确认
        </Button>
      </div>
    </Card>
  )
}

/**
 * Build the floating annotation card as a self-contained React island rendered
 * with the app's shadcn/ui components. Positioning and selection state stay with
 * the inspect bridge; this module only paints DOM and forwards user intent.
 */
export function createAnnotationCard(handlers: CardHandlers): {
  el: HTMLDivElement
  render: (entry: CardEntry) => void
} {
  ensureCardStyle()

  const el = document.createElement("div")
  el.dataset.draftlyCard = "true"
  Object.assign(el.style, {
    position: "fixed",
    width: "300px",
    zIndex: "2147483647",
    display: "none",
  } as CSSStyleDeclaration)

  const root = createRoot(el)
  // Remount on each render so local field state re-initialises from the entry
  // snapshot (matches the previous imperative rebuild). render() is only called
  // on selection/message changes, never on in-card typing, so focus is safe.
  let nonce = 0
  const render = (entry: CardEntry) => {
    nonce += 1
    root.render(<AnnotationCard key={nonce} entry={entry} handlers={handlers} />)
  }

  return { el, render }
}
