"use client"

// A panel with no tabs yet (spec §4.1): one question, a few answers the data
// can actually give, and two ready-made starting points. Whatever is sent goes
// to the copilot, which builds the widget.
import { useState } from "react"
import { ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { PANEL_TEMPLATES, type Suggestion } from "@/lib/widgets/suggestions"

export function EmptyPanel({ suggestions, onSubmit }: { suggestions: Suggestion[]; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("")
  const send = () => {
    const t = text.trim()
    if (!t) return
    onSubmit(t)
    setText("")
  }
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 pt-14 pb-10 sm:px-6">
      <h2 className="text-lg font-semibold text-foreground">¿Qué quieres ver?</h2>
      <p className="mt-1 text-center text-sm text-muted-foreground">
        Pídelo con tus palabras y la IA lo arma como gráfica en tu panel.
      </p>
      <form
        className="relative mt-5 w-full"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Ej. «las citas organizadas por etapa del pipeline»"
          rows={2}
          aria-label="¿Qué quieres ver?"
          className="min-h-[56px] w-full resize-none bg-card pr-12 text-sm"
        />
        <Button type="submit" size="icon" disabled={!text.trim()} aria-label="Enviar" className="absolute right-2 bottom-2 h-8 w-8">
          <ArrowUp className="h-4 w-4" />
        </Button>
      </form>
      {suggestions.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onSubmit(s.prompt)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <p className="mt-8 text-xs text-muted-foreground">
        o empieza con un panel armado:{" "}
        {PANEL_TEMPLATES.map((t, i) => (
          <span key={t.label}>
            {i > 0 && <span aria-hidden> · </span>}
            <button type="button" onClick={() => onSubmit(t.prompt)} className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline">
              {t.label}
            </button>
          </span>
        ))}
      </p>
    </div>
  )
}
