# Citas por mes por asesor — design

**Date:** 2026-05-24
**Surface:** Sales (Ventas) dashboard
**Goal:** Add a stacked bar chart showing total appointments per month, broken down by asesor.

## Summary

Add a new chart card titled **"Citas por mes por asesor"** under the existing "Citas" section in `sales-dashboard.tsx`. X axis is month/year, Y axis is appointment count, segments are asesores. All statuses are counted. Clicking a segment opens the existing `AppointmentDrillDrawer` filtered to that asesor × month. No new files, types, or API changes required.

## Scope

**In scope**

- New `useMemo` aggregation inside `SalesDashboard` (`apptByMonthByAdvisor`).
- New chart card in `components/dashboard/sales-dashboard.tsx`, placed below "Citas por estatus por asesor".
- Click handler wiring into the existing `AppointmentDrillDrawer`.

**Out of scope (YAGNI)**

- Filtering by status.
- Date range beyond the existing 90-day window already fetched.
- Exporting the chart.
- Per-status line overlays.

## Data aggregation

Single `useMemo` (`apptByMonthByAdvisor`) returns:

```ts
{
  data: Array<{ month: string; label: string } & Record<string, number>>,
  advisors: string[],   // sorted alphabetically
  total: number,        // total appointments with an assignedTo
}
```

- Source: `appointments` prop (already filtered client-side by asesor filter in `app/page.tsx`).
- Skip appointments with no `assignedTo`.
- Group by `month = appt.startTime.slice(0, 7)` ("YYYY-MM").
- Month label formatted `es-MX`: `new Date(year, month - 1, 1).toLocaleDateString("es-MX", { month: "short", year: "numeric" })`.
- Months sorted chronologically (string sort on "YYYY-MM" is safe).
- Advisors sorted alphabetically, consistent with `convByAdvisorMonthData`.

## Chart

**Component:** `BarChart` from recharts via shadcn `ChartContainer`, same import set already in the file.

**Config:**

```ts
Object.fromEntries(
  advisors.map((advisor, i) => [
    advisor,
    { label: advisor, color: COLOR_PALETTE[i % COLOR_PALETTE.length] },
  ])
)
```

**Layout:**

- Vertical bars (X = months, Y = count). Standard orientation, same as "Conversaciones únicas por asesor".
- Height: 320px fixed.
- Margin: `{ left: 8, right: 8, top: 16, bottom: 32 }`.
- `<XAxis dataKey="label" tick={{ fontSize: 11 }} />`.
- `<YAxis tick={{ fontSize: 11 }} allowDecimals={false} />`.
- `<ChartTooltip content={<ChartTooltipContent />} />`.
- `<Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />`.
- One `<Bar>` per advisor: `stackId="appt-month"`, `fill={COLOR_PALETTE[i]}`, top-bar gets `radius={[3, 3, 0, 0]}` others `[0,0,0,0]`.

**Empty state:** `"Sin citas para mostrar"` (same wording as the existing citas chart).

**Footer:** `"Haz clic en un segmento para ver las citas"`.

## Click handler

```ts
onClick={(data: any) => {
  const matched = appointments.filter(
    (a) => a.assignedTo === advisor && a.startTime.slice(0, 7) === data.month
  )
  setApptDrill({
    open: true,
    title: `${advisor} · ${data.label}`,
    appointments: matched,
  })
}}
```

Reuses existing `apptDrill` / `setApptDrill` state and `AppointmentDrillDrawer` already mounted in the dashboard.

## Placement

```tsx
<SectionHeader title="Citas" />
<Card>  {/* existing: Citas por estatus por asesor */}</Card>

{/* NEW: */}
<Card>
  <CardHeader>
    <CardTitle>Citas por mes por asesor</CardTitle>
    <TotalBadge value={apptByMonthByAdvisor.total} />
  </CardHeader>
  <CardContent>…</CardContent>
</Card>
```

## No new files or types

All data is already in `appointments[]`. No API, hook, type, or component files need to change — only `sales-dashboard.tsx`.

## Validation

- Manual: open the Ventas dashboard, confirm the chart renders with one bar per month and one segment per asesor.
- Manual: click a segment, confirm the drawer opens with only that asesor's appointments from that month.
- Manual: apply the asesor filter in the filter bar, confirm only that asesor's segment appears.
- Type check: `npm run lint`.
