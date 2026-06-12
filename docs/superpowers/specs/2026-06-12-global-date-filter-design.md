# Global Date Filter — Design

**Date:** 2026-06-12
**Status:** Approved for implementation

## Goal

Add a date-range filter at the very top of the panel, labeled "Fecha", with presets
**Semana, Mes, 3 meses, 6 meses** and a **Personalizado** option that opens start/end
date pickers. The filter applies to both the Marketing and Sales dashboards and
affects the entire panel (every KPI, chart, and table).

## Approach

Filter the dataset once in `app/page.tsx` (where tab state already lives) and pass
the already-filtered arrays down to both dashboards. The dashboards need zero
changes — they already receive data as props.

Rejected alternatives:

- *Per-dashboard filter state* — duplicates state, filter wouldn't persist when
  switching tabs.
- *Server-side filtering via API params* — GHL endpoints don't uniformly support
  date params (see CLAUDE.md); all existing filtering is client-side.

## Components

### `lib/date-range.ts` (new, no React)

- `DateFilterPreset = "week" | "month" | "3m" | "6m" | "all" | "custom"`
- `DateFilter = { preset, from?: Date, to?: Date }` — `from`/`to` only used by `custom`.
- `resolveDateRange(filter, now?)` → `{ from: Date, to: Date } | null`
  - `week` = last 7 days, `month` = last 30 days (rolling), `3m`/`6m` = rolling
    calendar months back, all ending at end-of-today.
  - `custom` = `startOfDay(from)` → `endOfDay(to ?? from)`.
  - `all` (and `custom` without `from`) → `null` (no filtering).
- `filterByDateRange(items, getDate, range)` — generic; items with a missing or
  unparseable date are **kept** (safer than silently dropping them).

### `components/dashboard/date-range-filter.tsx` (new)

Sticky bar (same styling idiom as the old `filter-bar.tsx`): a "Fecha" label,
a segmented control with Semana / Mes / 3 meses / 6 meses / Todo, and a
"Personalizado" outline button that opens a Popover containing a 2-month
`Calendar` in `range` mode (`date-fns/locale/es`). When a custom range is active
the button shows the formatted range (e.g. "12 ene 26 – 11 jun 26").

**Default: "Todo"** — the panel shows everything until the user narrows it.

### `app/page.tsx` (modified)

- `const [dateFilter, setDateFilter] = useState<DateFilter>({ preset: "all" })`
- `useMemo` the resolved range and the filtered arrays.
- Date field per entity: Contact → `createdAt` (alias of `dateAdded`),
  Opportunity → `createdAt`, Call → `createdAt`, Appointment → `startTime`,
  Task → `createdAt ?? dueDate`, Pauta → `createdAt`, Message → `createdAt`.
- The bar renders between the tab nav and the content, visible on the
  Marketing and Ventas tabs (hidden on Asistente IA).
- The AI chat (`ConversationsChat`) keeps the **unfiltered** dataset — the
  assistant should be able to answer about all data, and the bar is hidden there.
- Header chips ("Contactos/Oportunidades/Pautas cargadas") stay unfiltered —
  they report what was loaded, not what is shown.

## Error handling

No new failure modes: filtering is pure client-side array work. Invalid dates in
data fall through as "keep".

## Testing

No automated tests in this project (per CLAUDE.md). Verification = `npm run build`
+ `npx tsc --noEmit` + manual check in the running app.
