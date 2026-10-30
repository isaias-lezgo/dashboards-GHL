"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fieldLabel, METRIC_PHRASES } from "@/lib/widgets/labels"
import { formatMetric } from "./format"
import type { VizProps } from "./viz-types"

export function VizTable({ result, widget, currency, height, onDrill }: VizProps) {
  const q = widget.query!
  const dimHeaders = q.groupBy.map((g) => {
    const f = g.dimension.replace(/^(opportunity|contact)\./, "")
    const label = fieldLabel(f)
    return label.charAt(0).toUpperCase() + label.slice(1)
  })
  const metricHeaders = q.metrics.map((m) => {
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
                  {formatMetric(v, q.metrics[i].metric, currency)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
