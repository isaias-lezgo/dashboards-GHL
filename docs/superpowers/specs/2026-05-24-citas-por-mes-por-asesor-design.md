# Citas por mes por asesor — design

**Date:** 2026-05-24
**Surface:** Sales (Ventas) dashboard
**Goal:** Replace the existing "Citas por estatus por asesor" chart (asesor on X axis) with a grouped+stacked chart where months are on the X axis, each month has one stacked bar per asesor, and each bar is stacked by appointment status.

## Summary

Replace the current chart card in `sales-dashboard.tsx` under the "Citas" section. Title becomes **"Citas por mes por asesor"**. X axis = months, grouped bars within each month = asesores, stacked segments = statuses. All statuses are counted (no filter). Clicking a segment opens the existing `AppointmentDrillDrawer` filtered to that asesor × month × status. No new files, types, or API changes.

## Scope

**In scope**

- Replace `apptByStatusByAdvisor` useMemo with `apptByMonthByAdvisor` useMemo — new pivot shape.
- Replace chart rendering in the "Citas" card.
- Update click handler to filter by asesor + month + status.

**Out of scope (YAGNI)**

- Global date filter integration (chart uses the fixed 90-day window already fetched).
- Exporting the chart.
- Sub-labels under each bar showing asesor names.
- Per-status line overlays.

## Data aggregation

Replace `apptByStatusByAdvisor` with a new `apptByMonthByAdvisor` useMemo:

```ts
{
  data: Array<{ month: string; label: string } & Record<string, number>>,
  advisors: string[],   // sorted alphabetically, stable order
  statuses: string[],   // sorted by KNOWN_APPT_STATUS_ORDER, then unknowns alphabetically
  total: number,        // appointments with an assignedTo
}
```

**Pivot logic:**
- Skip appointments with no `assignedTo`.
- Key: `month = appt.startTime.slice(0, 7)` ("YYYY-MM").
- Column key per data row: `` `${advisor}_${status}` `` (e.g., `"Ana_showed"`).
- Month label: `new Date(year, month - 1, 1).toLocaleDateString("es-MX", { month: "short", year: "numeric" })`.
- Months sorted chronologically (string sort on "YYYY-MM" is correct).
- Advisors sorted alphabetically for stable grouped bar order.
- Statuses sorted: known order first (`showed`, `confirmed`, `new`, `noshow`, `cancelled`, `invalid`), then unknowns alphabetically — same sort as the old chart.

## Chart

**Recharts grouped + stacked pattern:**

Each `(advisor, status)` pair becomes one `<Bar>`:

```tsx
advisors.flatMap((advisor, ai) =>
  statuses.map((status, si) => (
    <Bar
      key={`${advisor}_${status}`}
      dataKey={`${advisor}_${status}`}
      stackId={advisor}           // groups statuses into the asesor bar
      fill={apptStatusVisual(status, si).color}
      name={`${advisor} · ${apptStatusVisual(status, si).label}`}
      legendType="none"           // suppress per-(advisor,status) legend entries
      cursor="pointer"
      radius={si === statuses.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
      onClick={(data: any) => {
        const matched = appointments.filter(
          (a) => a.assignedTo === advisor && a.startTime.slice(0, 7) === data.month && a.status === status
        )
        setApptDrill({ open: true, title: `${advisor} · ${apptStatusVisual(status, si).label} · ${data.label}`, appointments: matched })
      }}
    />
  ))
)
```

**Custom status legend** (since `legendType="none"` suppresses auto-legend):

```tsx
<Legend
  content={() => (
    <div className="flex flex-wrap gap-3 justify-center pt-2">
      {statuses.map((status, i) => {
        const { label, color } = apptStatusVisual(status, i)
        return (
          <span key={status} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
            {label}
          </span>
        )
      })}
    </div>
  )}
/>
```

**Chart config** (for ChartContainer — uses advisor colors so tooltip label resolves):

```ts
Object.fromEntries(
  advisors.flatMap((advisor, ai) =>
    statuses.map((status, si) => [
      `${advisor}_${status}`,
      { label: `${advisor} · ${apptStatusVisual(status, si).label}`, color: apptStatusVisual(status, si).color },
    ])
  )
)
```

**Layout:**
- `BarChart` vertical (X = month, Y = count), same orientation as "Conversaciones por asesor".
- Height: 320px.
- Margin: `{ left: 8, right: 8, top: 16, bottom: 32 }`.
- `<XAxis dataKey="label" tick={{ fontSize: 11 }} />`.
- `<YAxis tick={{ fontSize: 11 }} allowDecimals={false} />`.
- `<ChartTooltip content={<ChartTooltipContent />} />`.

**Empty state:** `"Sin citas para mostrar"`.
**Footer:** `"Haz clic en un segmento para ver las citas"`.

## Click handler

```ts
onClick={(data: any) => {
  const matched = appointments.filter(
    (a) =>
      a.assignedTo === advisor &&
      a.startTime.slice(0, 7) === data.month &&
      a.status === status
  )
  setApptDrill({
    open: true,
    title: `${advisor} · ${apptStatusVisual(status, si).label} · ${data.label}`,
    appointments: matched,
  })
}}
```

Reuses existing `apptDrill` / `setApptDrill` state and `AppointmentDrillDrawer` already mounted.

## What changes

- `apptByStatusByAdvisor` useMemo → replaced by `apptByMonthByAdvisor` useMemo (new pivot shape).
- `apptChartConfig` useMemo → replaced by new config derived from `advisors × statuses`.
- Chart rendering inside the "Citas" card → replaced entirely.
- Card title: `"Citas por estatus por asesor"` → `"Citas por mes por asesor"`.

## What does NOT change

- `AppointmentDrillDrawer` component — unchanged.
- `apptDrill` / `setApptDrill` state — unchanged.
- `APPT_STATUS_CONFIG`, `KNOWN_APPT_STATUS_ORDER`, `apptStatusVisual` — unchanged.
- All other charts, KPIs, drawers — unchanged.
- No API, hook, type, or component files outside `sales-dashboard.tsx`.

## Validation

- Manual: open the Ventas dashboard, confirm one bar group per month with one stacked bar per asesor.
- Manual: click a segment, confirm the drawer opens with appointments matching that asesor + month + status.
- Manual: apply the asesor filter in the filter bar, confirm only that asesor's bar appears in each month group.
- Type check: `npm run lint`.
