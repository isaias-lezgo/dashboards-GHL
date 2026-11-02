"use client"

// line · area. Time on the x axis (the engine guarantees a date bucket first and
// fills empty buckets: counts with 0, ratios with null, which draws a gap).
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { BRAND_AMBER, CHART_GRID_STROKE, CHART_TICK, NonZeroTooltipContent } from "@/components/dashboard/dashboard-ui"
import { colorForKey, valueFormatters } from "./format"
import { pivot, type VizProps } from "./viz-types"

export function VizLine({ result, widget, currency, height, onDrill }: VizProps) {
  const q = widget.query!
  const multi = result.rows.some((r) => r.key.length > 1)
  const p = pivot(result)
  // A single series has no second label; name it after the ratio or the metric.
  const names = multi ? p.series : [q.ratio?.label ?? q.metrics[0].label ?? widget.title]
  // One series is the lead series: amber. Several get their stable entity colors.
  const config: ChartConfig = Object.fromEntries(
    names.map((s, i) => [p.seriesKey(i), { label: s, color: multi ? colorForKey(s) : BRAND_AMBER }])
  )
  const { fmt, tick } = valueFormatters(result, widget, currency)
  const onClick = (state: { activeLabel?: string | number } | null) => {
    const label = state?.activeLabel
    if (label === undefined) return
    const records = p.byCategory.get(String(label)) ?? []
    if (records.length) onDrill(`${widget.title}: ${label}`, records)
  }
  const common = {
    data: p.data,
    margin: { top: 4, right: 12, left: 0, bottom: 4 },
    onClick,
    className: "cursor-pointer",
  }
  // Recharts 2 finds axes only among DIRECT children, so these are spread into
  // each chart as an array — a fragment would hide them.
  const axes = [
    <CartesianGrid key="grid" stroke={CHART_GRID_STROKE} vertical={false} />,
    <XAxis key="x" dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={false} minTickGap={16} />,
    <YAxis key="y" tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => tick(Number(v))} />,
    <ChartTooltip key="tip" content={<NonZeroTooltipContent formatter={(v, name) => `${config[String(name)]?.label ?? name}: ${fmt(Number(v))}`} />} />,
  ]
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      {widget.viz === "area" ? (
        <AreaChart {...common}>
          {axes}
          <Area type="monotone" dataKey={p.seriesKey(0)} stroke="var(--color-s0)" fill="var(--color-s0)" fillOpacity={0.15} strokeWidth={2} connectNulls={false} />
        </AreaChart>
      ) : (
        <LineChart {...common}>
          {axes}
          {names.map((s, i) => (
            <Line
              key={s}
              type="monotone"
              dataKey={p.seriesKey(i)}
              stroke={`var(--color-${p.seriesKey(i)})`}
              strokeWidth={2}
              dot={p.data.length <= 31 ? { r: 3 } : false}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      )}
    </ChartContainer>
  )
}
