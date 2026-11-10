"use client"

// The tab's widgets in a 12-column grid. Layout is an ORDERED list with preset
// sizes — what an AI handles well ("pon los KPI arriba" = reorder a list) and
// responsive by construction. Each row is stretched to the full width
// (lib/widgets/layout.ts): preset sizes alone leave holes no choice of sizes can
// avoid — an `l` (8 of 12) never fills a row — and deleting a widget opens more.
import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"
import type { EngineContext } from "@/lib/widgets/semantic"
import type { Tab } from "@/lib/widgets/spec"
import { widgetSpans } from "@/lib/widgets/layout"
import { WidgetCard } from "./widget-card"

// Spans come from CSS variables so one class serves every width; below md every
// widget is full width.
const SPAN_CLASS =
  "col-span-12 md:[grid-column:span_var(--span-md)/span_var(--span-md)] lg:[grid-column:span_var(--span-lg)/span_var(--span-lg)]"

export function WidgetGrid({
  tab,
  ctx,
  selectedWidgetId,
  onSelect,
  onEditWithAi,
  onEditFilters,
  onDelete,
  onRetryConversations,
  conversationProgress,
}: {
  tab: Tab
  ctx: EngineContext
  selectedWidgetId: string | null
  onSelect: (id: string | null) => void
  onEditWithAi: (id: string) => void
  onEditFilters: (id: string) => void
  onDelete: (id: string) => void
  onRetryConversations?: () => void
  conversationProgress?: { scanned: number; threads: number } | null
}) {
  if (tab.widgets.length === 0) {
    return (
      <div className="mx-4 mt-4 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center sm:mx-6">
        <p className="text-sm font-medium text-foreground">Esta pestaña está vacía</p>
        <p className="mt-1 text-xs text-muted-foreground">Pídele al copiloto lo que quieres ver aquí.</p>
      </div>
    )
  }
  const spans = widgetSpans(tab.widgets.map((w) => w.size))
  return (
    <div className="grid grid-cols-12 gap-4 px-4 py-4 sm:px-6">
      {tab.widgets.map((w, i) => (
        <div
          key={w.id}
          className={cn(SPAN_CLASS, "min-w-0")}
          style={{ "--span-md": spans[i].md, "--span-lg": spans[i].lg } as CSSProperties}
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
            onRetryConversations={onRetryConversations}
            conversationProgress={conversationProgress}
          />
        </div>
      ))}
    </div>
  )
}
