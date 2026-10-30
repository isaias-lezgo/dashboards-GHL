"use client"

// TEMPORARY (Task 17 verification, removed in Task 18): one widget per viz over
// the real dataset, plus the two failure states the plan requires to be visible.
import { useMemo } from "react"
import { WidgetCard } from "./widget-card"
import type { DashboardPayload, Message } from "@/lib/types"
import type { EngineContext } from "@/lib/widgets/semantic"
import type { QuerySpec, Widget, WidgetSpec } from "@/lib/widgets/spec"

const q = (over: Partial<QuerySpec>): QuerySpec => ({
  source: "opportunities",
  metrics: [{ metric: "count", label: null }],
  groupBy: [],
  filters: [],
  relatedFilters: [],
  time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" },
  globalFilters: "inherit",
  sort: { by: "value", dir: "desc" },
  limit: null,
  ...over,
})
const w = (id: string, spec: Partial<WidgetSpec>): Widget => ({
  title: id,
  subtitle: null,
  viz: "bar",
  size: "m",
  height: "normal",
  query: q({}),
  text: null,
  target: null,
  nativeId: null,
  prompt: "",
  id,
  createdAt: "2026-10-30T00:00:00Z",
  createdBy: "ai",
  updatedAt: "2026-10-30T00:00:00Z",
  ...spec,
})
const g = (dimension: string, bucket: QuerySpec["groupBy"][number]["bucket"] = null, join: QuerySpec["groupBy"][number]["join"] = null) => ({ dimension, bucket, join })

const WIDGETS: Widget[] = [
  w("Oportunidades (KPI)", { viz: "kpi", size: "s", height: "compact", query: q({ time: { field: "createdAt", range: "last_30d", from: null, to: null, compare: "previous_period" } }) }),
  w("Conversión", { viz: "kpi", size: "s", height: "compact", query: q({ metrics: [{ metric: "win_rate", label: null }] }) }),
  w("Citas por etapa", { viz: "bar", query: q({ source: "appointments", groupBy: [g("opportunity.stage", null, "latest")], time: { field: "startTime", range: "inherit", from: null, to: null, compare: "none" } }) }),
  w("Oportunidades por fuente", { viz: "bar_horizontal", query: q({ groupBy: [g("sourceCategory")] }) }),
  w("Leads por mes y plataforma", { viz: "stacked_bar", size: "l", query: q({ groupBy: [g("createdAt", "month"), g("platform")], sort: { by: "natural", dir: "asc" }, time: { field: "createdAt", range: "last_90d", from: null, to: null, compare: "none" } }) }),
  w("Leads por semana", { viz: "line", query: q({ source: "contacts", groupBy: [g("createdAt", "week")], sort: { by: "natural", dir: "asc" }, time: { field: "createdAt", range: "last_90d", from: null, to: null, compare: "none" } }) }),
  w("Embudo", { viz: "funnel", query: q({ groupBy: [g("funnelState")], sort: { by: "natural", dir: "asc" } }) }),
  w("Asesores", { viz: "table", size: "l", query: q({ groupBy: [g("assignedTo")], metrics: [{ metric: "count", label: null }, { metric: "won_count", label: null }, { metric: "win_rate", label: null }], limit: 10 }) }),
  w("Contactos con negocio perdido", { viz: "record_list", query: q({ source: "contacts", relatedFilters: [{ entity: "opportunity", quantifier: "any", conditions: [{ anyOf: [{ field: "status", op: "eq", values: ["lost"] }] }] }], limit: 15, time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" } }) }),
  w("Nota", { viz: "text", query: null, text: "**Meta del mes:** 120 leads." }),
  w("Campo borrado", { viz: "bar", query: q({ source: "contacts", groupBy: [g("cf:Campo Borrado")], time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" } }) }),
  w("Costo por lead", { viz: "kpi", size: "s", height: "compact", query: q({ source: "ads_daily", metrics: [{ metric: "cpl", label: null }], time: { field: "date", range: "inherit", from: null, to: null, compare: "none" } }) }),
]

const COLS: Record<Widget["size"], string> = { s: "lg:col-span-3", m: "lg:col-span-6", l: "lg:col-span-8", xl: "lg:col-span-12" }

export function WidgetsDemo({ data, messages }: { data: DashboardPayload; messages: Message[] }) {
  const ctx: EngineContext = useMemo(
    () => ({
      dataset: { contacts: data.contacts, opportunities: data.opportunities, pautas: data.pautas, appointments: data.appointments, messages, tasks: data.tasks, calls: data.calls },
      pipelines: data.pipelines,
      ads: data.ads,
      dateRange: null,
      pipelineFilter: [],
      globalFilters: [],
      now: new Date(),
    }),
    [data, messages]
  )
  return (
    <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-12">
      {WIDGETS.map((widget) => (
        <div key={widget.id} className={COLS[widget.size]}>
          <WidgetCard widget={widget} ctx={ctx} selected={false} onEditWithAi={() => {}} onEditFilters={() => {}} onDelete={() => {}} />
        </div>
      ))}
    </div>
  )
}
