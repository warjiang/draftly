import { ArrowUpRight, Check, Layers3, Code2, FileText, Palette } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const weaverbird = new URL("./assets/logo.svg", import.meta.url).href

const editPoints = [
  {
    icon: FileText,
    title: "Shape the content",
    detail: "Replace the sample brief and page copy in src/App.tsx.",
  },
  {
    icon: Palette,
    title: "Set the visual system",
    detail: "Adjust semantic colors and radii in src/index.css.",
  },
  {
    icon: Code2,
    title: "Compose with primitives",
    detail: "Reuse the components in src/components/ui before adding new ones.",
  },
]

function App() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <header className="border-b bg-card/90">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <a
            href="#canvas"
            className="flex min-w-0 items-center gap-3 rounded-md font-semibold tracking-[-0.02em] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background">
              <Layers3 className="size-4" aria-hidden="true" />
            </span>
            <span className="truncate">Untitled project</span>
          </a>
          <Badge
            variant="outline"
            className="h-7 border-info/30 bg-info-soft px-2.5 text-info"
          >
            <Check aria-hidden="true" />
            Scaffold ready
          </Badge>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1440px] lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside
          className="border-b bg-card px-5 py-7 sm:px-6 lg:border-r lg:border-b-0 lg:px-7 lg:py-9"
          aria-labelledby="start-heading"
        >
          <div className="lg:sticky lg:top-8">
            <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
              Your starting point
            </p>
            <h1
              id="start-heading"
              className="mt-3 max-w-[14ch] text-3xl leading-[1.04] font-semibold tracking-[-0.045em]"
            >
              Make this canvas your own.
            </h1>
            <p className="mt-4 max-w-[32ch] text-sm leading-6 text-muted-foreground">
              The responsive shell, design tokens, and accessible components are
              ready. Replace the sample composition with your product.
            </p>

            <div className="relative mt-8">
              <div
                className="absolute top-4 bottom-4 left-[0.9375rem] w-px bg-info/35"
                aria-hidden="true"
              />
              <ol className="relative space-y-6">
                {editPoints.map(({ icon: Icon, title, detail }) => (
                  <li key={title} className="grid grid-cols-[1.875rem_1fr] gap-3">
                    <span className="grid size-[1.875rem] place-items-center rounded-full border border-info/35 bg-info-soft text-info">
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold">{title}</h2>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-8 border-t pt-5">
              <p className="font-mono text-xs text-muted-foreground">
                React 19 / Tailwind v4
              </p>
            </div>
          </div>
        </aside>

        <section
          id="canvas"
          className="canvas-grid min-w-0 px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8"
          aria-labelledby="canvas-heading"
        >
          <div className="mx-auto max-w-5xl">
            <div className="mb-3 flex min-h-9 items-center justify-between gap-3 px-1">
              <div>
                <h2 id="canvas-heading" className="text-sm font-semibold">
                  Live canvas
                </h2>
                <p className="text-xs text-muted-foreground">
                  Responsive preview
                </p>
              </div>
              <Badge variant="secondary" className="hidden sm:inline-flex">
                100% canvas width
              </Badge>
            </div>

            <div className="overflow-hidden rounded-xl border bg-card shadow-[0_20px_55px_rgba(37,34,75,0.12)]">
              <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center border-b bg-muted/65 px-3 sm:px-4">
                <span className="text-xs font-medium text-muted-foreground">
                  Preview
                </span>
                <span className="hidden rounded-md border bg-card px-3 py-1 font-mono text-[11px] text-muted-foreground sm:block">
                  localhost:5173
                </span>
                <span className="justify-self-end font-mono text-[11px] text-info">
                  Live
                </span>
              </div>

              <article className="bg-card" aria-label="Starter page preview">
                <nav
                  className="flex h-14 items-center justify-between border-b px-5 sm:px-8"
                  aria-label="Preview navigation"
                >
                  <span className="text-sm font-semibold tracking-[-0.02em]">
                    Your product
                  </span>
                  <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
                    <a className="hidden hover:text-foreground sm:inline" href="#preview-details">
                      Overview
                    </a>
                    <a className="hover:text-foreground" href="#preview-details">
                      Details
                    </a>
                  </div>
                </nav>

                <div className="grid min-h-[28rem] lg:grid-cols-[minmax(0,1.25fr)_minmax(16rem,.75fr)]">
                  <div className="flex flex-col justify-between px-5 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16">
                    <div>
                      <p className="text-sm font-medium text-primary">
                        A useful first screen
                      </p>
                      <h3 className="mt-4 max-w-[11ch] text-4xl leading-[0.98] font-semibold tracking-[-0.05em] sm:text-5xl">
                        Start with one clear idea.
                      </h3>
                      <p className="mt-5 max-w-[44ch] text-base leading-7 text-muted-foreground">
                        Explain what this page helps people do, then guide them
                        toward the next meaningful action.
                      </p>
                    </div>
                    <div className="mt-9 flex flex-wrap items-center gap-4">
                      <Button size="lg">
                        Primary action
                        <ArrowUpRight data-icon="inline-end" />
                      </Button>
                      <a
                        className="text-sm font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                        href="#preview-details"
                      >
                        Learn more
                      </a>
                    </div>
                  </div>

                  <section
                    id="preview-details"
                    className="flex flex-col justify-end border-t bg-secondary/65 p-5 sm:p-8 lg:border-t-0 lg:border-l lg:p-10"
                    aria-labelledby="details-heading"
                  >
                    <p className="font-mono text-xs text-muted-foreground">
                      Replace this section
                    </p>
                    <h4 id="details-heading" className="mt-3 text-xl font-semibold tracking-[-0.025em]">
                      Give supporting content a distinct role.
                    </h4>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      Use this area for a product visual, key proof, or the
                      context people need before they continue.
                    </p>
                  </section>
                </div>
              </article>
            </div>

            <footer className="mt-4 flex flex-col gap-2 px-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>Everything visible here is editable source.</span>
              <span className="flex items-center gap-2">
                <img
                  src={weaverbird}
                  alt=""
                  className="size-5 object-contain"
                  aria-hidden="true"
                />
                Scaffolded with Draftly
              </span>
            </footer>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
