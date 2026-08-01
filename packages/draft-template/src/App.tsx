import { ArrowUpRight, Check, Layers3, MousePointer2, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const foundations = [
  "Responsive layout",
  "Accessible states",
  "Reusable components",
  "Purposeful motion",
]

function App() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_32%)]" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-5 py-5 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b py-3">
          <a href="#canvas" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles aria-hidden="true" />
            </span>
            Draftly canvas
          </a>
          <Badge variant="outline">React · shadcn/ui · Tailwind v4</Badge>
        </header>

        <section id="canvas" className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,.85fr)]">
          <div className="flex max-w-3xl flex-col items-start gap-7">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Layers3 aria-hidden="true" />
              Source project ready
            </div>
            <div className="flex flex-col gap-5">
              <h1 className="max-w-3xl text-5xl font-semibold leading-[.95] tracking-[-.055em] text-balance sm:text-6xl lg:text-7xl">
                Turn this canvas into the product you described.
              </h1>
              <p className="max-w-[60ch] text-base leading-7 text-muted-foreground text-pretty sm:text-lg">
                The project already includes a responsive foundation, semantic design tokens,
                and shadcn/ui components. Replace this starter with a focused, complete interface.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg">
                Start composing
                <ArrowUpRight data-icon="inline-end" />
              </Button>
              <a className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline" href="#foundation">
                Review the foundation
              </a>
            </div>
          </div>

          <div id="foundation" className="relative lg:translate-y-10">
            <div className="absolute -inset-6 -rotate-2 rounded-3xl border bg-muted/45" aria-hidden="true" />
            <Card className="relative border-0 shadow-[0_2rem_5rem_color-mix(in_oklch,var(--foreground)_10%,transparent)]">
              <CardHeader className="border-b">
                <div className="mb-3 flex items-center justify-between">
                  <Badge variant="secondary">Build brief</Badge>
                  <MousePointer2 className="text-muted-foreground" aria-hidden="true" />
                </div>
                <CardTitle className="text-xl tracking-tight">A stronger starting point</CardTitle>
                <CardDescription className="max-w-[42ch] leading-6">
                  Use the existing primitives before creating custom controls. Keep the hierarchy
                  clear and make every important state visible.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-3" aria-label="Project foundation">
                  {foundations.map((item) => (
                    <li key={item} className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5 text-sm font-medium">
                      <span className="flex size-6 items-center justify-center rounded-md bg-background text-primary">
                        <Check aria-hidden="true" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Built for source-level iteration.</span>
          <span className="font-mono tabular-nums">src/App.tsx · ready</span>
        </footer>
      </div>
    </main>
  )
}

export default App
