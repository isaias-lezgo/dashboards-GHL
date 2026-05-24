# Citas por estatus por asesor — design

**Date:** 2026-05-23
**Surface:** Sales (Ventas) dashboard
**Goal:** A new chart showing the count of appointments (citas) per status, broken down by asesor.

## Summary

Add a stacked vertical bar chart to the Ventas dashboard titled **"Citas por estatus por asesor"**. X axis is asesores, Y axis is appointment count, segments are appointment statuses (Asistió, No asistió, Confirmada, Pendiente, Cancelada, Inválida, plus any other GHL status that appears in the data).

Data comes from a new step inside `/api/dashboard` that bulk-fetches calendar events from GHL for each asesor over a fixed 90-day window. Clicking a segment opens a new drill drawer listing the matching appointments.

## Scope

**In scope**

- New internal type `Appointment` in `lib/types.ts`.
- New fetch step in `app/api/dashboard/route.ts` that returns `appointments: Appointment[]` in the streamed `data` payload.
- New chart card in `components/dashboard/sales-dashboard.tsx`, under a new "Citas" section header.
- New `AppointmentDrillDrawer` component for segment click-through.
- Mock appointment data so the dev fallback continues to render the chart.

**Out of scope (YAGNI)**

- Filtering appointments by status in the global filter bar.
- Exporting the chart.
- Percentage / show-rate labels next to bars.
- Per-calendar breakdown.
- Real-time updates.

## Data scope

- **Source:** all appointments for the location, fetched via `GET /calendars/events?userId=...&startTime=...&endTime=...` for each asesor.
- **Window:** fixed `now − 90 days` to `now`. Not configurable, does not honor the dashboard's global date filter.
- **Asesor filter:** respected. The chart only shows columns for asesores present in the filtered `appointments` array (filtering happens client-side in `app/page.tsx`, same as opportunities and messages today).
- **Other filters (pipeline, source, etc.):** not applied. They don't map to appointments meaningfully.

## Data layer

### Internal type — `lib/types.ts`

```ts
export interface Appointment {
  id: string
  contactId: string
  assignedTo?: string      // mapped to advisor name, not GHL userId
  title?: string
  startTime: string
  endTime: string
  status: string           // raw GHL appointmentStatus, lowercased; "sin estado" when absent
  notes?: string
}
```

### GHL client — `lib/ghl-client.ts`

Extend `getCalendarEvents` params to accept `userId`. One-line change in the signature; `userId` is passed through `params`. Existing `calendarId`, `startTime`, `endTime` remain optional.

### API route — `app/api/dashboard/route.ts`

After the existing users/opportunities/messages steps, add an appointments step:

1. Compute `endTime = new Date().toISOString()` and `startTime = new Date(Date.now() - 90 * 86_400_000).toISOString()`.
2. For each `userId` in `userMap`, call `getCalendarEvents({ userId, startTime, endTime })` with bounded concurrency of 6 (same pool size as the per-conversation message fetch at `route.ts:322`).
3. Transform each `GHLCalendarEvent` → `Appointment`:
   - `assignedTo` resolves `assignedUserId` (or fallback to the queried user) via `userMap` → advisor name.
   - `status` is `appointmentStatus?.toLowerCase() ?? "sin estado"`.
   - `notes` carried through as-is.
4. Dedupe by event `id` (an event assigned to two users would otherwise appear twice — cheap insurance).
5. Add `appointments` to the final `send({ type: "data", ... })` payload.

If `getCalendarEvents` rejects for a given user, that user contributes 0 appointments. `console.error` logs the user and reason — same swallow-and-continue pattern as the conversation fetch at `route.ts:343`. If every call fails, `appointments` is `[]` and the chart renders its empty state.

Stream a progress message (`"Cargando citas…"`) before the step, consistent with the existing progress events.

### Hook — `hooks/use-dashboard-data.ts`

No change. The streamed chunk is spread into the SWR cache; `appointments` flows through automatically.

### Mock fallback — `lib/mock-data.ts`

Add `mockAppointments: Appointment[]` generated against existing `mockContacts` and `DEFAULT_MEMBERS`, covering several statuses (showed, noshow, confirmed, new, cancelled) so the dev chart has meaningful data. Counts should be small (~30 total) — enough to render, not enough to clutter.

### Page — `app/page.tsx`

Pass `data?.appointments ?? mockAppointments` into `<SalesDashboard appointments={...} />`. Apply asesor filter client-side before passing down, matching the existing pattern for opportunities.

## Chart

### Placement

Inside `components/dashboard/sales-dashboard.tsx`, add a new section between "Actividad de Conversaciones" and "Análisis de Pérdidas":

```tsx
<SectionHeader title="Citas" />
<Card>
  <CardHeader>
    <CardTitle>Citas por estatus por asesor</CardTitle>
    <TotalBadge value={appointments.length} />
  </CardHeader>
  <CardContent>...</CardContent>
</Card>
```

### Props

`SalesDashboardProps` gains `appointments: Appointment[]`.

### Aggregation

Single `useMemo` returns:

```ts
{
  data: Array<{ member: string } & Record<string, number>>,
  statuses: string[],          // sorted distinct statuses present
  totalAppointments: number,
}
```

- Group by `appt.assignedTo`, then by `appt.status`.
- Drop appointments with no `assignedTo` (no asesor → can't render).
- Sort members by total appointments descending (most active asesor first), mirroring `revenueData`.
- Sort `statuses` to put known statuses first in a stable order: `showed`, `confirmed`, `new`, `noshow`, `cancelled`, `invalid`, then any unknowns alphabetically. This keeps the stack order legible across renders.

### Status colors and labels

```ts
const APPT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  showed:    { label: "Asistió",    color: "#10b981" },
  confirmed: { label: "Confirmada", color: "#3b82f6" },
  new:       { label: "Pendiente",  color: "#f59e0b" },
  noshow:    { label: "No asistió", color: "#ef4444" },
  cancelled: { label: "Cancelada",  color: "#94a3b8" },
  invalid:   { label: "Inválida",   color: "#a855f7" },
}
```

Unknown statuses receive a `COLOR_PALETTE[i]` color and a capitalized version of the raw status as the label.

### Render

Stacked vertical `BarChart` from recharts via the shadcn `ChartContainer`. Asesor name on X axis (angled `-35°` if there are >6 asesores, same heuristic as `trendData`'s period axis). Count on Y axis with `allowDecimals={false}`. One `<Bar dataKey={status} stackId="a">` per status. `<Legend />` at bottom. Tooltip uses the standard `ChartTooltipContent`.

Empty state: `"Sin citas para mostrar"`, matching existing empty states.

Footer hint: `"Haz clic en un segmento para ver las citas"`.

### Click handler

Each segment's `onClick(data)` calls:

```ts
openApptDrill(
  `${data.member} · ${APPT_STATUS_CONFIG[status]?.label ?? status}`,
  appointments.filter(a => a.assignedTo === data.member && a.status === status)
)
```

## Appointment drill drawer

New component: `components/dashboard/appointment-drill-drawer.tsx`.

The existing `ChartDrillDrawer` is built around `Opportunity[]`. Forcing appointments through it would require either casting appointments into a fake opportunity shape or threading a second mode through it. A dedicated drawer is simpler and keeps both components focused.

### State

```ts
interface AppointmentDrillState {
  open: boolean
  title: string
  appointments: Appointment[]
}

export const APPT_DRILL_CLOSED: AppointmentDrillState = { open: false, title: "", appointments: [] }
```

### Shell

shadcn `Sheet` opening from the right, same width and structure as `ChartDrillDrawer`. Header shows `title`; body is the appointment list.

### Body

List of cards, one per appointment, sorted by `startTime` descending. Each card shows:

- Status icon + colored badge — reuse the icon/badge logic already present in `detail-drawer.tsx:420-456` (`CalendarCheck` / `CalendarX` / `CalendarClock` mapped to confirmed / cancelled-or-noshow / other).
- Contact name, resolved via a `contacts: Contact[]` prop (build a `Map<id, Contact>` once per render).
- `title ?? "Cita"`.
- Date + time formatted `es-MX` (`day: "2-digit", month: "short", year: "numeric"` for date; `hour: "2-digit", minute: "2-digit"` for time).
- `notes` line-clamped to 2 lines.

Clicking a contact name opens the existing `DetailDrawer` for that contact — same pattern as `ChartDrillDrawer:158-161`.

Empty state: `"Sin citas en este segmento."`

### Wiring

`SalesDashboard` owns the drawer state alongside the existing `drill` state. The drawer is mounted once at the bottom of the dashboard, next to `<ChartDrillDrawer />`.

## Component boundaries

- `app/api/dashboard/route.ts` owns appointment fetching and transformation. The chart never sees a raw GHL shape.
- `SalesDashboard` owns aggregation and chart rendering. Aggregation is a single `useMemo`, contained.
- `AppointmentDrillDrawer` owns the drill-through UI. It only depends on `Appointment[]`, `Contact[]`, and a callback to open the `DetailDrawer` — no coupling to the chart's aggregation.

The chart's aggregation `useMemo` is small enough to keep inside `sales-dashboard.tsx`, matching how every other chart on that page handles its own aggregation. If the file grows further in a future change, that's the moment to extract.

## Error handling

- Per-user GHL fetch failure → that user contributes 0 appointments; `console.error` only.
- All fetches fail → `appointments: []`; chart renders empty state.
- Mock fallback covers the "no GHL token" path.

No global page-level error states added.

## Validation

- Manual: hit `/api/dashboard` and confirm the streamed `data` chunk includes an `appointments` array.
- Manual: open the Ventas dashboard, confirm the chart renders, segments are clickable, and the drawer lists the right appointments.
- Manual: clear `GHL_API_TOKEN` from `.env.local`, restart dev, confirm the chart still renders against mock data.
