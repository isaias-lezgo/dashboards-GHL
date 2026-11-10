// Row filling for the panel grid. Pure and client-safe.
//
// A widget's `size` is a preset share of a 12-column row (s=3, m=6, l=8, xl=12
// on wide screens). Presets alone leave holes: an `l` can never fill a row
// (8+3=11, 8+6=14), any run whose sizes do not add up to 12 leaves one, and so
// does deleting a widget later. Neither the AI picking sizes nor `grid-auto-flow:
// dense` can close them, so the grid packs the widgets into rows IN ORDER and
// stretches each row's widgets to fill it. Order is the layout ("pon los KPI
// arriba" = reorder the list); the size is a proportion, not a promise.

import type { Widget } from "./spec"

export const GRID_COLUMNS = 12

type Size = Widget["size"]

/** Columns each size takes per breakpoint before filling. Below md everything is full width. */
export const BASE_SPAN: Record<"md" | "lg", Record<Size, number>> = {
  md: { s: 6, m: 12, l: 12, xl: 12 },
  lg: { s: 3, m: 6, l: 8, xl: 12 },
}

/**
 * Packs base spans into rows of `columns`, in order, and grows each row to
 * exactly `columns`. The spare columns go out in proportion to each widget's
 * base span (largest remainder; ties to the earlier widget), so a 3+6 row
 * becomes 4+8, not 6+6 — the wide one stays the wide one.
 */
export function fillRows(spans: number[], columns = GRID_COLUMNS): number[] {
  const out: number[] = []
  let row: number[] = []
  let used = 0
  const flush = () => {
    if (row.length === 0) return
    const spare = columns - used
    const shares = row.map((s) => (spare * s) / used)
    const grown = row.map((s, i) => s + Math.floor(shares[i]))
    let left = columns - grown.reduce((a, b) => a + b, 0)
    const order = row
      .map((_, i) => i)
      .sort((a, b) => shares[b] - Math.floor(shares[b]) - (shares[a] - Math.floor(shares[a])) || a - b)
    for (const i of order) {
      if (left <= 0) break
      grown[i] += 1
      left -= 1
    }
    out.push(...grown)
    row = []
    used = 0
  }
  for (const raw of spans) {
    const s = Math.min(Math.max(1, Math.round(raw)), columns)
    if (used + s > columns) flush()
    row.push(s)
    used += s
  }
  flush()
  return out
}

/** The filled span of every widget, per breakpoint, in the tab's order. */
export function widgetSpans(sizes: Size[]): Array<{ md: number; lg: number }> {
  const md = fillRows(sizes.map((s) => BASE_SPAN.md[s]))
  const lg = fillRows(sizes.map((s) => BASE_SPAN.lg[s]))
  return sizes.map((_, i) => ({ md: md[i], lg: lg[i] }))
}
