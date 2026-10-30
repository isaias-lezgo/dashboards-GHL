// Number formatting and stable colors for AI-panel widgets.
import { CHART_PALETTE } from "@/components/dashboard/dashboard-ui"
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

export function colorForKey(key: string): string {
  let slot = slots.get(key)
  if (slot === undefined) {
    slot = slots.size
    slots.set(key, slot)
  }
  return CHART_PALETTE[slot % CHART_PALETTE.length]
}
