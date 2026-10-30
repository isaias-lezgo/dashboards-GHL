"use client"

// kpi · record_list · text.
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { METRICS } from "@/lib/widgets/metrics"
import { METRIC_PHRASES } from "@/lib/widgets/labels"
import type { SourceId } from "@/lib/widgets/spec"
import { formatMetric } from "./format"
import type { Row, VizProps } from "./viz-types"

export function VizKpi({ result, widget, currency, onDrill }: VizProps) {
  const q = widget.query!
  const metric = q.metrics[0].metric
  const value = result.totals[0]
  const prev = result.compare?.totals[0] ?? null
  let delta: { text: string; up: boolean } | null = null
  if (value !== null && prev !== null) {
    if (METRICS[metric].kind === "rate") {
      const pts = (value - prev) * 100
      delta = { text: `${pts >= 0 ? "+" : ""}${pts.toLocaleString("es-MX", { maximumFractionDigits: 1 })} pts`, up: pts >= 0 }
    } else if (prev !== 0) {
      const pct = ((value - prev) / Math.abs(prev)) * 100
      delta = { text: `${pct >= 0 ? "+" : ""}${pct.toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`, up: pct >= 0 }
    }
  }
  const records = result.rows[0]?.records ?? []
  return (
    <button
      type="button"
      className="flex w-full flex-col items-start gap-1 rounded-md text-left disabled:cursor-default"
      disabled={records.length === 0 || q.source === "ads_daily"}
      onClick={() => onDrill(widget.title, records)}
    >
      <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{formatMetric(value, metric, currency)}</span>
      <span className="text-[11px] text-muted-foreground">
        {q.metrics[0].label ?? METRIC_PHRASES[metric]}
        {delta && (
          <span className={`ml-2 inline-flex items-center gap-0.5 font-medium ${delta.up ? "text-emerald-600" : "text-red-600"}`}>
            {delta.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {delta.text} vs. {q.time.compare === "previous_year" ? "año anterior" : "periodo anterior"}
          </span>
        )}
      </span>
    </button>
  )
}

function recordLine(source: SourceId, r: Row): { title: string; detail: string; date?: string } {
  const s = (v: unknown) => (typeof v === "string" ? v : "")
  switch (source) {
    case "contacts":
      return { title: s(r.name) || s(r.email) || s(r.phone) || "Sin nombre", detail: s(r.source), date: s(r.createdAt) }
    case "opportunities":
      return { title: s(r.name) || "Oportunidad", detail: [s(r.stage), s(r.assignedTo)].filter(Boolean).join(" · "), date: s(r.createdAt) }
    case "appointments":
      return { title: s(r.title) || "Cita", detail: s(r.status), date: s(r.startTime) }
    case "tasks":
      return { title: s(r.title) || "Tarea", detail: [s(r.status), s(r.assignedToName)].filter(Boolean).join(" · "), date: s(r.dueDate) }
    case "pautas":
      return { title: s(r.nombrePauta) || s(r.tipo) || "Pauta", detail: s(r.tipo), date: s(r.createdAt) }
    default:
      return { title: s(r.date), detail: "" }
  }
}

export function VizRecordList({ result, widget, height, onDrill }: VizProps) {
  const q = widget.query!
  const records = (result.rows[0]?.records ?? []).slice(0, q.limit ?? 25)
  return (
    <div className="overflow-y-auto" style={{ maxHeight: height }}>
      <ul className="divide-y divide-border/50">
        {records.map((r, i) => {
          const line = recordLine(q.source, r)
          const date = line.date ? new Date(line.date) : null
          return (
            <li key={String(r.id ?? i)}>
              <button type="button" onClick={() => onDrill(line.title, [r])} className="flex w-full items-center justify-between gap-3 px-1 py-1.5 text-left hover:bg-muted/50">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-foreground">{line.title}</span>
                  {line.detail && <span className="block truncate text-[11px] text-muted-foreground">{line.detail}</span>}
                </span>
                {date && !Number.isNaN(date.getTime()) && (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{format(date, "d MMM yyyy", { locale: es })}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {result.meta.recordCount > records.length && (
        <p className="px-1 pt-1.5 text-[11px] text-muted-foreground">
          Mostrando {records.length} de {result.meta.recordCount.toLocaleString("es-MX")}
        </p>
      )}
    </div>
  )
}

export function VizText({ text, createdAt }: { text: string; createdAt: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      <p className="mt-2 text-[10px] text-muted-foreground">Nota del {format(new Date(createdAt), "d MMM yyyy", { locale: es })}</p>
    </div>
  )
}
