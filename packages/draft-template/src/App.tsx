import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

function App() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 px-8 py-24">
        <div className="flex max-w-2xl flex-col gap-5">
          <p className="text-sm font-medium text-muted-foreground">Draftly starter</p>
          <h1 className="text-5xl font-semibold tracking-tight">
            Your generated interface starts here.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            Replace this starter with a complete, responsive product experience.
          </p>
        </div>
        <Button size="lg" className="w-fit">
          Get started
          <ArrowRight data-icon="inline-end" />
        </Button>
      </section>
    </main>
  )
}

export default App
