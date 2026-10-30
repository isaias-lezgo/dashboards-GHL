"use client"

// One AI-panel widget: runs its query through the engine on every render of new
// data, and says out loud everything a reader needs to trust the number — the
// widget's rule (ScopePill), its own filters (chips), Meta's state, and any
// warning from the engine. A widget that cannot be computed says so; it never
// shows a zero or goes blank.
import { useMemo, useState } from "react"
import { AlertTriangle, Clock, MoreHorizontal, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ChartCardContent,
  ChartCardHeader,
  ChartEmpty,
  ChartHint,
  DashboardCard,
  ScopePill,
} from "@/components/dashboard/dashboard-ui"
import { runQuery, type QueryResult } from "@/lib/widgets/engine"
import { describeFilterChips, describeWidget } from "@/lib/widgets/describe"
import { fieldLabel, SOURCE_LABELS } from "@/lib/widgets/labels"
import type { EngineContext } from "@/lib/widgets/semantic"
import type { Widget } from "@/lib/widgets/spec"
import { sanitizeBrand } from "@/lib/pdf/branding"
import { WidgetDrill, type WidgetDrillState } from "./widget-drill"
import { VizBar } from "./viz-bar"
import { VizLine } from "./viz-line"
import { VizFunnel } from "./viz-funnel"
import { VizTable } from "./viz-table"
import { VizKpi, VizRecordList, VizText } from "./viz-simple"
import type { VizProps } from "./viz-types"

export const PLOT_HEIGHT: Record<Widget["height"], number> = { compact: 110, normal: 230, tall: 370 }

function pillLabel(widget: Widget): string {
  const q = widget.query
  if (!q) return "Nota"
  const g = q.groupBy[0]
  if (!g) return SOURCE_LABELS[q.source]
  const field = g.dimension.replace(/^(opportunity|contact)\./, "")
  return `por ${fieldLabel(field)}`
}

function Notice({ tone, title, children }: { tone: "amber" | "muted"; title: string; children?: React.ReactNode }) {
  const Icon = tone === "amber" ? AlertTriangle : Clock
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
        tone === "amber" ? "border-primary/25 bg-primary/[0.05]" : "border-border bg-muted/30"
      )}
    >
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone === "amber" ? "text-primary/70" : "text-muted-foreground")} aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="text-[12px] font-semibold leading-snug text-foreground">{title}</p>
        {children && <p className="text-[11px] leading-relaxed text-muted-foreground">{children}</p>}
      </div>
    </div>
  )
}

export function WidgetCard({
  widget,
  ctx,
  selected,
  onEditWithAi,
  onEditFilters,
  onDelete,
}: {
  widget: Widget
  ctx: EngineContext
  selected: boolean
  onEditWithAi: (id: string) => void
  onEditFilters: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [drill, setDrill] = useState<WidgetDrillState | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const outcome = useMemo((): { result: QueryResult } | { error: string } | null => {
    if (!widget.query) return null
    try {
      return { result: runQuery(widget.query, ctx) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }, [widget, ctx])

  const chips = useMemo(() => describeFilterChips(widget), [widget])
  const overridden = outcome && "result" in outcome ? outcome.result.meta.overriddenGlobals.length > 0 : false
  const crmFilterActive = ctx.pipelineFilter.length > 0 || ctx.globalFilters.length > 0
  const height = PLOT_HEIGHT[widget.height]
  const currency = ctx.ads?.currency

  const body = (() => {
    if (widget.viz === "text") return <VizText text={widget.text ?? ""} createdAt={widget.createdAt} />
    if (!outcome) return null
    if ("error" in outcome) {
      return <ChartEmpty message={`No se pudo calcular: ${outcome.error}. Pídele a la IA que la ajuste.`} height={Math.min(height, 160)} />
    }
    const { result } = outcome
    const meta = result.meta
    if (meta.adsStatus === "pending") {
      return (
        <Notice tone="muted" title="Todavía no revisamos el gasto de Meta para esta cuenta">
          Presiona «Actualizar» para traerlo.
        </Notice>
      )
    }
    if (meta.adsStatus && meta.adsStatus !== "connected") {
      return (
        <Notice tone="amber" title="Sin datos de inversión en Meta">
          {sanitizeBrand(meta.adsMessage ?? "La cuenta publicitaria no está vinculada en el CRM.")}
        </Notice>
      )
    }
    const empty = widget.viz === "kpi" ? false : widget.viz === "record_list" ? meta.recordCount === 0 : result.rows.every((r) => r.records.length === 0 && (r.values[0] ?? 0) === 0)
    if (empty) return <ChartEmpty message="Sin datos para este periodo." height={Math.min(height, 160)} />
    const props: VizProps = {
      result,
      widget,
      currency,
      height,
      onDrill: (title, records) => {
        if (widget.query && widget.query.source !== "ads_daily" && records.length) setDrill({ title, source: widget.query.source, records })
      },
    }
    switch (widget.viz) {
      case "kpi":
        return <VizKpi {...props} />
      case "bar":
      case "bar_horizontal":
      case "stacked_bar":
      case "grouped_bar":
        return <VizBar {...props} />
      case "line":
      case "area":
        return <VizLine {...props} />
      case "funnel":
        return <VizFunnel {...props} />
      case "table":
        return <VizTable {...props} />
      case "record_list":
        return <VizRecordList {...props} />
    }
  })()

  const result = outcome && "result" in outcome ? outcome.result : null

  return (
    <DashboardCard className={cn("flex h-full flex-col", selected && "border-primary/60 ring-1 ring-primary/30")}>
      <ChartCardHeader
        title={widget.title}
        actions={
          <div className="flex items-center gap-1">
            <ScopePill label={pillLabel(widget)} tooltip={describeWidget(widget)} />
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editar con IA" onClick={() => onEditWithAi(widget.id)}>
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </Button>
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Más opciones">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-1">
                {[
                  { label: "Editar con IA", icon: Sparkles, run: () => onEditWithAi(widget.id) },
                  { label: "Filtros y fechas", icon: SlidersHorizontal, run: () => onEditFilters(widget.id) },
                  { label: "Eliminar", icon: Trash2, run: () => onDelete(widget.id), danger: true },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      item.run()
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted",
                      item.danger && "text-destructive"
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        }
      />
      <ChartCardContent className="flex flex-1 flex-col gap-2">
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((chip) => (
              <span key={chip} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {chip}
                {overridden && !chip.endsWith("· fijo") ? " · fijo" : ""}
              </span>
            ))}
          </div>
        )}
        {result?.meta.crmFiltersIgnored && crmFilterActive && (
          <Notice tone="muted" title="Meta no tiene pipeline, asesor ni etapa: este bloque ignora esos filtros" />
        )}
        <div className="flex-1">{body}</div>
        {result?.meta.warnings.map((w) => <ChartHint key={w}>{w}</ChartHint>)}
      </ChartCardContent>
      <WidgetDrill drill={drill} onClose={() => setDrill(null)} ctx={ctx} />
    </DashboardCard>
  )
}
