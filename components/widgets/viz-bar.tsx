"use client"

// bar · bar_horizontal · stacked_bar · grouped_bar.
// One series → one color for every bar (amber, the lead series): coloring
// nominal categories by rank would encode nothing the bar length does not.
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { BRAND_AMBER, CHART_GRID_STROKE, CHART_TICK, NonZeroTooltipContent } from "@/components/dashboard/dashboard-ui"
import { METRIC_PHRASES } from "@/lib/widgets/labels"
import { colorForKey, formatMetric, formatTick } from "./format"
import { KEY_SEP, pivot, shortLabel, type Row, type VizProps } from "./viz-types"

export function VizBar({ result, widget, currency, height, onDrill }: VizProps) {
  const metric = widget.query!.metrics[0].metric
  const horizontal = widget.viz === "bar_horizontal"
  const multi = widget.viz === "stacked_bar" || widget.viz === "grouped_bar"
  const fmt = (v: number) => formatMetric(v, metric, currency)

  if (!multi) {
    const data = result.rows.map((r) => ({ label: r.label.join(" · "), value: r.values[0] ?? 0, records: r.records }))
    const config: ChartConfig = { value: { label: widget.query!.metrics[0].label ?? METRIC_PHRASES[metric], color: BRAND_AMBER } }
    const onClick = (d: { payload?: { label: string; records: Row[] } }) => {
      if (d?.payload) onDrill(`${widget.title}: ${d.payload.label}`, d.payload.records)
    }
    return (
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 4, right: 12, left: horizontal ? 4 : 0, bottom: 4 }}
        >
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={horizontal} horizontal={!horizontal} />
          {/* Recharts 2 finds axes only among DIRECT children — never wrap them in a fragment. */}
          {horizontal ? (
            <XAxis type="number" tick={CHART_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => formatTick(Number(v), metric)} />
          ) : (
            <XAxis
              dataKey="label"
              tick={CHART_TICK}
              tickLine={false}
              axisLine={false}
              interval={0}
              // Many categories: tilt the labels instead of letting them collide.
              angle={data.length > 6 ? -30 : 0}
              textAnchor={data.length > 6 ? "end" : "middle"}
              height={data.length > 6 ? 64 : 30}
              tickFormatter={(v) => shortLabel(String(v), data.length > 6 ? 18 : 14)}
            />
          )}
          {horizontal ? (
            <YAxis type="category" dataKey="label" width={150} tick={CHART_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => shortLabel(String(v), 22)} />
          ) : (
            <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => formatTick(Number(v), metric)} />
          )}
          <ChartTooltip content={<NonZeroTooltipContent formatter={(v) => fmt(Number(v))} />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} className="cursor-pointer" onClick={onClick} />
        </BarChart>
      </ChartContainer>
    )
  }

  const p = pivot(result)
  const config: ChartConfig = Object.fromEntries(p.series.map((s, i) => [p.seriesKey(i), { label: s, color: colorForKey(s) }]))
  const stacked = widget.viz === "stacked_bar"
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={p.data} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={false} interval={0} tickFormatter={(v) => shortLabel(String(v), 14)} />
        <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => formatTick(Number(v), metric)} />
        <ChartTooltip content={<NonZeroTooltipContent formatter={(v, name) => `${config[String(name)]?.label ?? name}: ${fmt(Number(v))}`} />} />
        {p.series.map((s, i) => (
          <Bar
            key={s}
            dataKey={p.seriesKey(i)}
            stackId={stacked ? "a" : undefined}
            fill={`var(--color-${p.seriesKey(i)})`}
            radius={stacked ? 0 : [4, 4, 0, 0]}
            className="cursor-pointer"
            onClick={(d: { payload?: { label: string } }) => {
              const cat = d?.payload?.label
              if (cat !== undefined) onDrill(`${widget.title}: ${cat} · ${s}`, p.records.get(`${cat}${KEY_SEP}${s}`) ?? [])
            }}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
