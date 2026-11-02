// Number formatting and stable colors for AI-panel widgets.
import { CHART_PALETTE, STRUCTURAL_NAVY } from "@/components/dashboard/dashboard-ui"
import type { QueryResult, ValueKind } from "@/lib/widgets/engine"
import type { Widget } from "@/lib/widgets/spec"
import { METRICS } from "@/lib/widgets/metrics"
import type { MetricId } from "@/lib/widgets/spec"

const ADS_AMOUNTS = new Set<MetricId>(["spend", "cpc", "cpm", "cpl"])

/**
 * One formatting rule per metric kind, the same across every widget: rates as
 * "12.5%", Meta amounts in the ad account's own currency (bare numbers when it
 * is unknown — never a guessed symbol), everything else es-MX grouped. A
 * missing value is "—", never 0.
 */
export function formatMetric(value: number | null | undefined, metric: MetricId, currency?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  const kind = METRICS[metric].kind
  if (kind === "rate") return `${(value * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`
  if (ADS_AMOUNTS.has(metric)) {
    return currency
      ? value.toLocaleString("es-MX", { style: "currency", currency, maximumFractionDigits: 2 })
      : value.toLocaleString("es-MX", { maximumFractionDigits: 2 })
  }
  if (kind === "amount") return value.toLocaleString("es-MX", { maximumFractionDigits: 0 })
  return value.toLocaleString("es-MX", { maximumFractionDigits: 0 })
}

/** Compact axis ticks: 12 300 → "12.3 mil". */
export function formatTick(value: number, metric: MetricId): string {
  if (METRICS[metric].kind === "rate") return `${Math.round(value * 100)}%`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} mil`
  return value.toLocaleString("es-MX", { maximumFractionDigits: 1 })
}

// Color follows the ENTITY, never its rank: the first value seen gets slot 0
// (amber, the lead series), the next one slot 1, and so on — and keeps it for
// the session, so "Meta" is the same color in every widget of the panel and a
// filter that changes the series count never repaints the survivors.
const slots = new Map<string, number>()

/**
 * Values that MEAN a color (spec 2026-11-02 §3.5): won/open/lost read the same
 * green, slate blue and red in every card, as in the hand-built dashboards. An
 * absent value ("Sin …", "(sin valor)", the beyond-the-window range) is grey —
 * it is a gap, not a category competing for attention.
 */
const FIXED_COLORS: Record<string, string> = {
  Ganada: "#22c55e",
  Abierta: STRUCTURAL_NAVY,
  Perdida: "#ef4444",
}
const MUTED = "#94a3b8"
const isAbsentKey = (key: string) => key === "(sin valor)" || key.startsWith("Sin ") || /o sin mensajes$/.test(key)

export function colorForKey(key: string): string {
  if (FIXED_COLORS[key]) return FIXED_COLORS[key]
  if (isAbsentKey(key)) return MUTED
  let slot = slots.get(key)
  if (slot === undefined) {
    slot = slots.size
    slots.set(key, slot)
  }
  return CHART_PALETTE[slot % CHART_PALETTE.length]
}

/** One rule per value kind — for charts whose values are not one catalog metric (several series, a ratio). */
export function formatValue(value: number | null | undefined, kind: ValueKind, currency?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  if (kind === "rate") return `${(value * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`
  if (kind === "amount" && currency) return value.toLocaleString("es-MX", { style: "currency", currency, maximumFractionDigits: 0 })
  return value.toLocaleString("es-MX", { maximumFractionDigits: 0 })
}

export function formatTickKind(value: number, kind: ValueKind): string {
  if (kind === "rate") return `${Math.round(value * 100)}%`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} mil`
  return value.toLocaleString("es-MX", { maximumFractionDigits: 1 })
}

/** The formatters a card uses: by the result's value kind when it has one, else by its first metric. */
export function valueFormatters(result: QueryResult, widget: Widget, currency?: string) {
  const kind = result.meta.valueKind
  const metric = widget.query!.metrics[0].metric
  return kind
    ? { fmt: (v: number | null) => formatValue(v, kind, currency), tick: (v: number) => formatTickKind(v, kind) }
    : { fmt: (v: number | null) => formatMetric(v, metric, currency), tick: (v: number) => formatTick(v, metric) }
}

/** "62.5% · 5 de 8" — a ratio row says what it divides. */
export function ratioText(value: number | null, parts: [number | null, number | null] | undefined): string {
  const pct = formatValue(value, "rate")
  if (!parts) return pct
  const n = (x: number | null) => (x === null ? "—" : x.toLocaleString("es-MX", { maximumFractionDigits: 0 }))
  return `${pct} · ${n(parts[0])} de ${n(parts[1])}`
}
