import { endOfDay, startOfDay, subDays, subMonths } from "date-fns"

export type DateFilterPreset = "week" | "month" | "3m" | "6m" | "all" | "custom"

export interface DateFilter {
  preset: DateFilterPreset
  // Only used when preset === "custom"
  from?: Date
  to?: Date
}

export interface ResolvedDateRange {
  from: Date
  to: Date
}

export function resolveDateRange(
  filter: DateFilter,
  now: Date = new Date()
): ResolvedDateRange | null {
  const to = endOfDay(now)

  switch (filter.preset) {
    case "week":
      return { from: startOfDay(subDays(now, 7)), to }
    case "month":
      return { from: startOfDay(subDays(now, 30)), to }
    case "3m":
      return { from: startOfDay(subMonths(now, 3)), to }
    case "6m":
      return { from: startOfDay(subMonths(now, 6)), to }
    case "custom":
      if (!filter.from) return null
      return {
        from: startOfDay(filter.from),
        to: endOfDay(filter.to ?? filter.from),
      }
    case "all":
    default:
      return null
  }
}

// Items with a missing or unparseable date are kept rather than dropped.
export function filterByDateRange<T>(
  items: T[],
  getDate: (item: T) => string | undefined,
  range: ResolvedDateRange | null
): T[] {
  if (!range) return items

  const fromMs = range.from.getTime()
  const toMs = range.to.getTime()

  return items.filter((item) => {
    const iso = getDate(item)
    if (!iso) return true
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) return true
    return t >= fromMs && t <= toMs
  })
}

// Above this many contacts OR opportunities, the dashboard opens on the last
// month instead of the whole history. The cost this avoids is NOT the data
// fetch — that comes from the cache in about a second — it is the browser
// rendering charts over tens of thousands of records, which pins the main
// thread and makes the whole machine sluggish. Measured on a 30k-contact /
// 25k-opportunity account.
//
// A threshold rather than a per-client setting: a client crossing it is a fact
// about their data, not a preference, and one number is one thing to reason
// about.
export const LARGE_DATASET_THRESHOLD = 12_000

export function isLargeDataset(counts: {
  contacts: number
  opportunities: number
}): boolean {
  return (
    counts.contacts > LARGE_DATASET_THRESHOLD ||
    counts.opportunities > LARGE_DATASET_THRESHOLD
  )
}
