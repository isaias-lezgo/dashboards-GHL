import type { Opportunity, Pipeline } from "./types"

// The global pipeline filter — the second dimension of the panel's filtering,
// alongside lib/date-range.ts. Pure and UI-free so app/page.tsx, the dashboards
// and the verification script all read the same rules.
//
// THE ASYMMETRY THAT SHAPES THIS FILE: the pipeline exists only on the
// opportunity. Contacts, pautas, citas, tareas and mensajes carry no pipeline of
// their own and never will — GHL doesn't have the concept outside an
// opportunity. So the filter runs in two steps: opportunities are filtered
// directly, and everything else is filtered by a set of contact ids DERIVED from
// those opportunities. Every subtlety below comes from that one fact.

/**
 * Selected pipeline ids. **Empty means "todos"**, not "ninguno" — it is the
 * panel's default state, so an empty selection has to be a strict passthrough
 * rather than a filter that happens to match nothing.
 */
export type PipelineFilter = string[]

export function isPipelineFilterActive(filter: PipelineFilter): boolean {
  return filter.length > 0
}

/**
 * The contacts that belong to the selected pipelines: those with at least one
 * opportunity in one of them. `null` means "no filter active" and is the signal
 * every consumer below uses to skip work entirely.
 *
 * **Pass the FULL opportunity set, never the date-filtered slice.** Pipeline
 * membership is a fact about a contact, not about the active date window: a
 * contact whose only opportunity in this pipeline was created two years ago
 * still belongs to it, and deriving the set from the filtered slice would drop
 * them along with every pauta, cita and mensaje hanging off them. That
 * understates precisely the accounts with the longest history, and it does so
 * silently — the panel still renders, just describing a smaller population than
 * its own header claims. Same invariant the drill-down joins already carry.
 */
export function contactIdsInPipelines(
  opportunities: Opportunity[],
  filter: PipelineFilter
): Set<string> | null {
  if (!isPipelineFilterActive(filter)) return null

  const wanted = new Set(filter)
  const contactIds = new Set<string>()
  for (const opp of opportunities) {
    if (wanted.has(opp.pipelineId) && opp.contactId) contactIds.add(opp.contactId)
  }
  return contactIds
}

/** Opportunities are the one dataset that carries its own pipeline. */
export function filterOpportunitiesByPipelines(
  opportunities: Opportunity[],
  filter: PipelineFilter
): Opportunity[] {
  if (!isPipelineFilterActive(filter)) return opportunities

  const wanted = new Set(filter)
  return opportunities.filter((o) => wanted.has(o.pipelineId))
}

/**
 * Everything that isn't an opportunity: kept when its contact is in the derived
 * set. Mirrors `filterByDateRange`'s shape (items in, items out, a null range
 * meaning "todo") so the two global filters compose in app/page.tsx without
 * either one knowing about the other.
 *
 * Rows with no contact id are DROPPED while the filter is active, unlike the
 * date filter's undated rows, which are kept. The two differ because the
 * unknowns differ: an undated row is still one of *these* leads, whereas a row
 * with no contact cannot be attributed to any pipeline at all, and keeping the
 * unattributable rows was the explicitly rejected alternative — it would put
 * pautas on screen that the selected pipeline does not explain.
 */
export function filterByContactIds<T>(
  items: T[],
  getContactId: (item: T) => string | undefined,
  allowed: Set<string> | null
): T[] {
  if (!allowed) return items

  return items.filter((item) => {
    const contactId = getContactId(item)
    return !!contactId && allowed.has(contactId)
  })
}

/**
 * The pipelines the panel should currently reason about — the whole roster when
 * the filter is off.
 *
 * This is what fixes the stage axis. Both dashboards derive their stage order by
 * walking the `pipelines` prop, so feeding them only the selected pipelines
 * turns an axis that merged every stage name in the account (17 distinct ones on
 * a 23-pipeline sub-account, 31 on another) into the selected pipeline's real
 * stages in GHL's own order — without either dashboard needing to know the
 * filter exists.
 *
 * Returns them in the account's pipeline order, not the order they were
 * clicked, so the axis doesn't reshuffle as the user ticks boxes. Ids with no
 * matching pipeline (deleted in GHL since the sync) are ignored.
 */
export function selectedPipelines(
  pipelines: Pipeline[],
  filter: PipelineFilter
): Pipeline[] {
  if (!isPipelineFilterActive(filter)) return pipelines

  const wanted = new Set(filter)
  return pipelines.filter((p) => wanted.has(p.id))
}

/** Human label for the filter button and the PDF report cover. */
export function pipelineFilterLabel(
  pipelines: Pipeline[],
  filter: PipelineFilter
): string {
  if (!isPipelineFilterActive(filter)) return "Todos los pipelines"

  const selected = selectedPipelines(pipelines, filter)
  if (selected.length === 1) return selected[0].name
  return `${filter.length} pipeline${filter.length === 1 ? "" : "s"}`
}
