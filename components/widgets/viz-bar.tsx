"use client"

// bar · bar_horizontal · stacked_bar · grouped_bar.
// One series → one color for every bar (amber, the lead series): coloring
// nominal categories by rank would encode nothing the bar length does not.
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { BRAND_AMBER, CHART_GRID_STROKE, CHART_TICK, NonZeroTooltipContent } from "@/components/dashboard/dashboard-ui"
import { METRIC_PHRASES } from "@/lib/widgets/labels"
import { colorForKey, ratioText, valueFormatters } from "./format"
import { SeriesLegend } from "./series-legend"
import { KEY_SEP, pivot, shortLabel, type Row, type VizProps } from "./viz-types"

export function VizBar({ result, widget, currency, height, onDrill }: VizProps) {
  const q = widget.query!
  const metric = q.metrics[0].metric
  const horizontal = widget.viz === "bar_horizontal"
  // Several series (spec 2026-11-02 §3.1) come back as 2-dimension rows whatever the viz says.
  const multi = widget.viz === "stacked_bar" || widget.viz === "grouped_bar" || result.rows.some((r) => r.key.length > 1)
  const { fmt, tick } = valueFormatters(result, widget, currency)
  const ratio = result.meta.ratio

  if (!multi) {
    const data = result.rows.map((r) => ({ label: r.label.join(" · "), value: ratio ? r.values[0] : (r.values[0] ?? 0), records: r.records, parts: r.parts }))
    const config: ChartConfig = { value: { label: q.ratio?.label ?? q.metrics[0].label ?? METRIC_PHRASES[metric], color: BRAND_AMBER } }
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
            <XAxis type="number" tick={CHART_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => tick(Number(v))} />
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
            // interval 0: Recharts otherwise drops labels when rows are tight, and the
            // biggest bar can end up nameless. Short enough not to wrap in 150px.
            <YAxis type="category" dataKey="label" width={150} interval={0} tick={CHART_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => shortLabel(String(v), 20)} />
          ) : (
            <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => tick(Number(v))} />
          )}
          <ChartTooltip
            content={
              <NonZeroTooltipContent
                formatter={(v, _n, item) => (ratio ? ratioText(Number(v), (item?.payload as { parts?: [number | null, number | null] } | undefined)?.parts) : fmt(Number(v)))}
              />
            }
          />
          <Bar dataKey="value" fill="var(--color-value)" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} className="cursor-pointer" onClick={onClick} />
        </BarChart>
      </ChartContainer>
    )
  }

  const p = pivot(result)
  const config: ChartConfig = Object.fromEntries(p.series.map((s, i) => [p.seriesKey(i), { label: s, color: colorForKey(s) }]))
  const stacked = widget.viz === "stacked_bar"
  return (
    <>
    <SeriesLegend items={p.series.map((s) => ({ label: s, color: colorForKey(s) }))} />
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={p.data} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
        <XAxis
          dataKey="label"
          tick={CHART_TICK}
          tickLine={false}
          axisLine={false}
          interval={0}
          // Many categories (months of a year): tilt instead of letting labels collide.
          angle={p.data.length > 6 ? -30 : 0}
          textAnchor={p.data.length > 6 ? "end" : "middle"}
          height={p.data.length > 6 ? 64 : 30}
          tickFormatter={(v) => shortLabel(String(v), p.data.length > 6 ? 18 : 14)}
        />
        <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => tick(Number(v))} />
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
              if (cat === undefined) return
              const i = result.meta.seriesLabels?.indexOf(s) ?? -1
              const source = i > 0 ? q.series?.[i - 1]?.source : undefined
              onDrill(`${widget.title}: ${cat} · ${s}`, p.records.get(`${cat}${KEY_SEP}${s}`) ?? [], source)
            }}
          />
        ))}
      </BarChart>
    </ChartContainer>
    </>
  )
}
