"use client"

// The tab's widgets in a 12-column grid. Layout is an ORDERED list with preset
// sizes — what an AI handles well ("pon los KPI arriba" = reorder a list) and
// responsive by construction. `grid-auto-flow: dense` back-fills holes left by
// a narrow widget after a wide one.
import { cn } from "@/lib/utils"
import type { EngineContext } from "@/lib/widgets/semantic"
import type { Tab, Widget } from "@/lib/widgets/spec"
import { WidgetCard } from "./widget-card"

const SPAN: Record<Widget["size"], string> = {
  s: "col-span-12 md:col-span-6 lg:col-span-3",
  m: "col-span-12 lg:col-span-6",
  l: "col-span-12 lg:col-span-8",
  xl: "col-span-12",
}

export function WidgetGrid({
  tab,
  ctx,
  selectedWidgetId,
  onSelect,
  onEditWithAi,
  onEditFilters,
  onDelete,
}: {
  tab: Tab
  ctx: EngineContext
  selectedWidgetId: string | null
  onSelect: (id: string | null) => void
  onEditWithAi: (id: string) => void
  onEditFilters: (id: string) => void
  onDelete: (id: string) => void
}) {
  if (tab.widgets.length === 0) {
    return (
      <div className="mx-4 mt-4 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center sm:mx-6">
        <p className="text-sm font-medium text-foreground">Esta pestaña está vacía</p>
        <p className="mt-1 text-xs text-muted-foreground">Pídele al copiloto lo que quieres ver aquí.</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-12 gap-4 px-4 py-4 [grid-auto-flow:dense] sm:px-6">
      {tab.widgets.map((w) => (
        <div
          key={w.id}
          className={cn(SPAN[w.size], "min-w-0")}
          onClickCapture={() => {
            if (selectedWidgetId && selectedWidgetId !== w.id) onSelect(null)
          }}
        >
          <WidgetCard
            widget={w}
            ctx={ctx}
            selected={selectedWidgetId === w.id}
            onEditWithAi={onEditWithAi}
            onEditFilters={onEditFilters}
            onDelete={onDelete}
          />
        </div>
      ))}
    </div>
  )
}
