import type { QueryResult } from "@/lib/widgets/engine"
import type { Widget } from "@/lib/widgets/spec"

export type Row = Record<string, unknown>

export interface VizProps {
  result: QueryResult
  widget: Widget
  currency?: string
  /** Height of the plot area in px. */
  height: number
  onDrill: (title: string, records: Row[]) => void
}

export const KEY_SEP = "\u0000"

/** Long category labels on axes are cut; the tooltip carries the full text. */
export function shortLabel(s: string, max = 18): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/**
 * Rows of a 2-dimension result pivoted for Recharts: one datum per category
 * (first dimension) with one numeric field per series (second dimension), plus
 * the records behind every cell for the drill-down.
 */
export function pivot(result: QueryResult, metricIndex = 0) {
  const categories: string[] = []
  const series: string[] = []
  const records = new Map<string, Row[]>()
  const byCategory = new Map<string, Row[]>()
  const values = new Map<string, number | null>()
  for (const r of result.rows) {
    const cat = r.label[0] ?? ""
    const ser = r.label[1] ?? ""
    if (!categories.includes(cat)) categories.push(cat)
    if (!series.includes(ser)) series.push(ser)
    records.set(`${cat}${KEY_SEP}${ser}`, r.records)
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), ...r.records])
    values.set(`${cat}${KEY_SEP}${ser}`, r.values[metricIndex])
  }
  const seriesKey = (i: number) => `s${i}`
  const data = categories.map((cat) => {
    const datum: Record<string, string | number | null> = { label: cat }
    series.forEach((ser, i) => {
      datum[seriesKey(i)] = values.get(`${cat}${KEY_SEP}${ser}`) ?? 0
    })
    return datum
  })
  return { data, categories, series, seriesKey, records, byCategory }
}
