"use client"

// Where the pipeline stands RIGHT NOW: open opportunities per stage in GHL's
// order, then Ganado / Abandonado / Perdido. Deliberately no "% between steps":
// the sync holds only each opportunity's current stage, so such a percentage
// would be a distribution posing as a conversion rate (spec §7.1).
import { BRAND_AMBER, STRUCTURAL_NAVY } from "@/components/dashboard/dashboard-ui"
import { formatMetric } from "./format"
import type { VizProps } from "./viz-types"

const TERMINAL_COLORS: Record<string, string> = {
  Ganado: BRAND_AMBER,
  Abandonado: "#94a3b8",
  Perdido: "#ef4444",
}

export function VizFunnel({ result, widget, currency, onDrill }: VizProps) {
  const metric = widget.query!.metrics[0].metric
  const max = Math.max(1, ...result.rows.map((r) => r.values[0] ?? 0))
  return (
    <div className="space-y-1.5">
      {result.rows.map((r) => {
        const label = r.label[0]
        const value = r.values[0] ?? 0
        const color = TERMINAL_COLORS[label] ?? STRUCTURAL_NAVY
        return (
          <button
            key={r.key.join("|")}
            type="button"
            onClick={() => onDrill(`${widget.title}: ${label}`, r.records)}
            className="group grid w-full grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 rounded-md px-1 py-0.5 text-left hover:bg-muted/50"
          >
            <span className="truncate text-xs text-foreground">{label}</span>
            <span className="h-3.5 rounded-sm bg-muted/60">
              <span className="block h-full rounded-sm" style={{ width: `${(value / max) * 100}%`, backgroundColor: color }} />
            </span>
            <span className="text-xs font-semibold tabular-nums text-foreground">{formatMetric(value, metric, currency)}</span>
          </button>
        )
      })}
    </div>
  )
}
