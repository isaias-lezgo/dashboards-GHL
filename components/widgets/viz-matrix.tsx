"use client"

// matrix: rows × columns of one metric, with totals and a heat shade
// (spec 2026-11-02 §3.6) — "asesor × etapa", "motivo × canal", "sin atención".
//
// Totals come from result.margins, measured over each row's / column's DEDUPED
// records: with multi-valued fields a record sits in several cells, so summing
// cells would count it twice. The shade ignores "Sin …" rows and columns — a gap
// that dominates the scale would wash out every real cell.
import { useMemo } from "react"
import { BRAND_AMBER } from "@/components/dashboard/dashboard-ui"
import { cn } from "@/lib/utils"
import { valueFormatters } from "./format"
import type { Row, VizProps } from "./viz-types"

const isAbsent = (label: string) => label === "(sin valor)" || label.startsWith("Sin ") || /o sin mensajes$/.test(label)

function amber(alpha: number): string {
  const n = parseInt(BRAND_AMBER.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function VizMatrix({ result, widget, currency, height, onDrill }: VizProps) {
  const { fmt } = valueFormatters(result, widget, currency)
  const m = useMemo(() => {
    const rows: { key: string; label: string }[] = []
    const cols: { key: string; label: string }[] = []
    const cells = new Map<string, { value: number | null; records: Row[] }>()
    for (const r of result.rows) {
      if (r.key.length < 2) continue
      if (!rows.some((x) => x.key === r.key[0])) rows.push({ key: r.key[0], label: r.label[0] })
      if (!cols.some((x) => x.key === r.key[1])) cols.push({ key: r.key[1], label: r.label[1] })
      cells.set(`${r.key[0]}\u0000${r.key[1]}`, { value: r.values[0], records: r.records })
    }
    let max = 0
    for (const r of rows) {
      if (isAbsent(r.label)) continue
      for (const c of cols) {
        if (isAbsent(c.label)) continue
        const v = cells.get(`${r.key}\u0000${c.key}`)?.value ?? 0
        if (v > max) max = v
      }
    }
    const union = (pick: (rowKey: string, colKey: string) => boolean) => {
      const out = new Set<Row>()
      for (const r of rows) for (const c of cols) if (pick(r.key, c.key)) for (const rec of cells.get(`${r.key}\u0000${c.key}`)?.records ?? []) out.add(rec)
      return [...out]
    }
    return { rows, cols, cells, max, union }
  }, [result])

  const margins = result.margins
  const total = (side: "first" | "second", key: string) => margins?.[side][key]?.[0] ?? null
  const shade = (label: string, colLabel: string, v: number | null) =>
    v && m.max > 0 && !isAbsent(label) && !isAbsent(colLabel) ? amber(0.08 + 0.62 * (v / m.max)) : undefined

  return (
    <div className="overflow-auto rounded-md border border-border/40" style={{ maxHeight: height }}>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border/60">
            <th className="sticky left-0 bg-card px-2 py-1.5 text-left font-medium text-muted-foreground" />
            {m.cols.map((c) => (
              <th key={c.key} className={cn("px-2 py-1.5 text-right font-medium", isAbsent(c.label) ? "text-muted-foreground/70" : "text-muted-foreground")}>
                {c.label}
              </th>
            ))}
            <th className="px-2 py-1.5 text-right font-semibold text-foreground">Total</th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.key} className="border-b border-border/30">
              <td className={cn("sticky left-0 max-w-[14rem] truncate bg-card px-2 py-1.5", isAbsent(r.label) ? "text-muted-foreground" : "text-foreground")} title={r.label}>
                {r.label}
              </td>
              {m.cols.map((c) => {
                const cell = m.cells.get(`${r.key}\u0000${c.key}`)
                const v = cell?.value ?? 0
                return (
                  <td
                    key={c.key}
                    className={cn("px-2 py-1.5 text-right tabular-nums", cell?.records.length ? "cursor-pointer hover:ring-1 hover:ring-inset hover:ring-primary/40" : "text-muted-foreground/60")}
                    style={{ backgroundColor: shade(r.label, c.label, v) }}
                    onClick={() => cell?.records.length && onDrill(`${widget.title}: ${r.label} · ${c.label}`, cell.records)}
                  >
                    {v ? fmt(v) : "–"}
                  </td>
                )
              })}
              <td
                className="cursor-pointer px-2 py-1.5 text-right font-semibold tabular-nums text-foreground hover:bg-muted/40"
                onClick={() => onDrill(`${widget.title}: ${r.label}`, m.union((rk) => rk === r.key))}
              >
                {fmt(total("first", r.key))}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border/60">
            <td className="sticky left-0 bg-card px-2 py-1.5 font-semibold text-foreground">Total</td>
            {m.cols.map((c) => (
              <td
                key={c.key}
                className="cursor-pointer px-2 py-1.5 text-right font-semibold tabular-nums text-foreground hover:bg-muted/40"
                onClick={() => onDrill(`${widget.title}: ${c.label}`, m.union((_rk, ck) => ck === c.key))}
              >
                {fmt(total("second", c.key))}
              </td>
            ))}
            <td className="px-2 py-1.5 text-right font-bold tabular-nums text-foreground">{fmt(result.totals[0])}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
