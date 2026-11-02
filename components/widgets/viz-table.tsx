"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fieldLabel, METRIC_PHRASES } from "@/lib/widgets/labels"
import { formatMetric, ratioText, valueFormatters } from "./format"
import { KEY_SEP, pivot, type VizProps } from "./viz-types"

export function VizTable(props: VizProps) {
  return props.result.meta.seriesLabels && !props.result.meta.ratio ? <SeriesTable {...props} /> : <RowsTable {...props} />
}

const header = (dimension: string) => {
  const label = fieldLabel(dimension.replace(/^(opportunity|contact)\./, ""))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Several series: one row per axis value, one column per series (Lezgo's "indicadores por semana"). */
function SeriesTable({ result, widget, currency, height, onDrill }: VizProps) {
  const q = widget.query!
  const { fmt } = valueFormatters(result, widget, currency)
  const labels = result.meta.seriesLabels ?? []
  const sourceOf = (i: number) => (i === 0 ? q.source : q.series?.[i - 1]?.source)
  const p = pivot(result)
  const noAxis = q.groupBy.length === 0
  return (
    <div className="overflow-auto rounded-md border border-border/40" style={{ maxHeight: height }}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {noAxis ? (
              <>
                <TableHead className="text-xs">Serie</TableHead>
                <TableHead className="text-right text-xs">Valor</TableHead>
              </>
            ) : (
              <>
                <TableHead className="text-xs">{header(q.groupBy[0].dimension)}</TableHead>
                {labels.map((l) => (
                  <TableHead key={l} className="text-right text-xs">{l}</TableHead>
                ))}
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {noAxis
            ? result.rows.map((r, i) => (
                <TableRow key={r.key.join("|")} className="cursor-pointer" onClick={() => onDrill(`${widget.title}: ${r.label[0]}`, r.records, sourceOf(i))}>
                  <TableCell className="text-xs text-foreground">{r.label[0]}</TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums text-foreground">{fmt(r.values[0])}</TableCell>
                </TableRow>
              ))
            : p.categories.map((cat, ci) => (
                <TableRow key={cat}>
                  <TableCell className="max-w-[16rem] truncate text-xs text-foreground">{cat}</TableCell>
                  {labels.map((l, i) => (
                    <TableCell
                      key={l}
                      className="cursor-pointer text-right text-sm font-semibold tabular-nums text-foreground hover:bg-muted/40"
                      onClick={() => onDrill(`${widget.title}: ${cat} · ${l}`, p.records.get(`${cat}${KEY_SEP}${l}`) ?? [], sourceOf(i))}
                    >
                      {fmt(p.data[ci][p.seriesKey(p.series.indexOf(l))] as number | null)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  )
}

function RowsTable({ result, widget, currency, height, onDrill }: VizProps) {
  const q = widget.query!
  const ratio = result.meta.ratio
  const dimHeaders = q.groupBy.map((g) => {
    const f = g.dimension.replace(/^(opportunity|contact)\./, "")
    const label = fieldLabel(f)
    return label.charAt(0).toUpperCase() + label.slice(1)
  })
  const metricHeaders = ratio ? [q.ratio?.label ?? "%"] : q.metrics.map((m) => {
    const text = m.label ?? METRIC_PHRASES[m.metric]
    return text.charAt(0).toUpperCase() + text.slice(1)
  })
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)

  const rows = useMemo(() => {
    if (!sort) return result.rows
    const dims = q.groupBy.length
    return [...result.rows].sort((a, b) => {
      if (sort.col < dims) return a.label[sort.col].localeCompare(b.label[sort.col], "es") * sort.dir
      const i = sort.col - dims
      return ((a.values[i] ?? -Infinity) - (b.values[i] ?? -Infinity)) * sort.dir
    })
  }, [result.rows, sort, q.groupBy.length])

  const headers = [...dimHeaders, ...metricHeaders]
  const toggle = (col: number) =>
    setSort((s) => (s && s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: col < dimHeaders.length ? 1 : -1 }))

  return (
    <div className="overflow-y-auto rounded-md border border-border/40" style={{ maxHeight: height }}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {headers.map((h, col) => (
              <TableHead key={col} className={col >= dimHeaders.length ? "text-right text-xs" : "text-xs"}>
                <button type="button" onClick={() => toggle(col)} className="inline-flex items-center gap-1 hover:text-foreground">
                  {h}
                  {sort?.col === col && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key.join("|")} className="cursor-pointer" onClick={() => onDrill(`${widget.title}: ${r.label.join(" · ")}`, r.records)}>
              {r.label.map((l, i) => (
                <TableCell key={i} className="max-w-[16rem] truncate text-xs text-foreground">
                  {l}
                </TableCell>
              ))}
              {r.values.map((v, i) => (
                <TableCell key={`v${i}`} className="text-right text-sm font-semibold tabular-nums text-foreground">
                  {ratio ? ratioText(v, r.parts) : formatMetric(v, q.metrics[i].metric, currency)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
