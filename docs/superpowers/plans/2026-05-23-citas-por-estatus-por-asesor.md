# Citas por estatus por asesor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stacked vertical bar chart to the Ventas dashboard showing the count of GHL appointments (citas) per appointment status, broken down by asesor, with click-through to a list of the matching appointments.

**Architecture:** A new fetch step inside the existing `/api/dashboard` streaming route bulk-fetches calendar events from GHL per asesor over a fixed 90-day window. The chart aggregates client-side in `sales-dashboard.tsx` and renders via recharts. A dedicated `AppointmentDrillDrawer` handles segment-click drill-down — separate from the opportunity-centric `ChartDrillDrawer`.

**Tech Stack:** Next.js 15 App Router, TypeScript, recharts, shadcn/ui, GHL REST API.

**Project test note:** This project has no automated test suite (per `CLAUDE.md`). Verification at each step is `npm run lint`, type-check via Next.js (build is gated on lint, not TS), and manual checks against the running dev server. Each task ends with a lint run + a manual verification step.

**Spec:** [docs/superpowers/specs/2026-05-23-citas-por-estatus-por-asesor-design.md](../specs/2026-05-23-citas-por-estatus-por-asesor-design.md)

---

## File Structure

**New files:**
- `components/dashboard/appointment-drill-drawer.tsx` — drawer that lists appointments for a clicked chart segment.

**Modified files:**
- `lib/types.ts` — add the `Appointment` internal type.
- `lib/ghl-client.ts` — extend `getCalendarEvents` to accept `userId`.
- `app/api/dashboard/route.ts` — fetch appointments per user, transform, dedupe, add to streamed payload.
- `hooks/use-dashboard-data.ts` — add `appointments: Appointment[]` to `DashboardData`.
- `lib/filter-helpers.ts` — add `filterAppointments` helper for asesor filtering.
- `app/page.tsx` — thread filtered appointments into `<SalesDashboard>`.
- `components/dashboard/sales-dashboard.tsx` — accept the new prop, build aggregation, render the new chart card under a new "Citas" section header, wire up the new drawer.

Each modified file keeps its existing responsibility. The new drawer is its own file because the existing `ChartDrillDrawer` is opportunity-shaped and would need a mode flag to accommodate appointments — a separate component is cleaner.

---

## Task 1: Add the `Appointment` internal type

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add the interface**

Add this block in `lib/types.ts` immediately after the `Task` interface (around line 53), before the `MessageChannel` type alias:

```ts
export interface Appointment {
  id: string
  contactId: string
  assignedTo?: string
  title?: string
  startTime: string
  endTime: string
  status: string
  notes?: string
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean (no new warnings for this file).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add Appointment internal type"
```

---

## Task 2: Extend `getCalendarEvents` to accept `userId`

**Files:**
- Modify: `lib/ghl-client.ts:412-424`

- [ ] **Step 1: Update the signature and params**

Replace the existing `getCalendarEvents` function (lines 412–424) with:

```ts
export async function getCalendarEvents(params?: {
  calendarId?: string;
  userId?: string;
  startTime?: string;
  endTime?: string;
}): Promise<GHLCalendarEventsResponse> {
  return ghlFetch<GHLCalendarEventsResponse>("/calendars/events", {
    params: {
      calendarId: params?.calendarId,
      userId: params?.userId,
      startTime: params?.startTime,
      endTime: params?.endTime,
    },
  });
}
```

This adds the `userId` param while leaving every existing call site valid (all four params are optional).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/ghl-client.ts
git commit -m "feat(ghl): accept userId in getCalendarEvents"
```

---

## Task 3: Fetch appointments per asesor in `/api/dashboard`

**Files:**
- Modify: `app/api/dashboard/route.ts`

- [ ] **Step 1: Import the new type and function**

In `app/api/dashboard/route.ts`, update imports.

Replace the existing import from `@/lib/ghl-client` (lines 1–14) so it includes `getCalendarEvents` and `GHLCalendarEvent`:

```ts
import {
  getAllContacts,
  getAllOpportunities,
  getPipelines,
  getConversations,
  getMessages,
  getUsers,
  getLostReasons,
  getCustomObjects,
  getAllCustomObjectRecords,
  getCalendarEvents,
  type GHLContact,
  type GHLConversation,
  type GHLOpportunity,
  type GHLCalendarEvent,
} from "@/lib/ghl-client";
```

Update the internal types import (line 16–24) to include `Appointment`:

```ts
import type {
  Contact,
  Opportunity,
  Call,
  Task,
  Message,
  Pipeline,
  Pauta,
  Appointment,
} from "@/lib/types";
```

- [ ] **Step 2: Add the appointments fetch block**

Locate the existing `const calls: Call[] = []` line (around `route.ts:356`). Insert this block immediately **before** that line — i.e., after the conversation fetch and before the empty `calls`/`tasks` declarations:

```ts
        // Fetch appointments per asesor over the last 90 days.
        // /calendars/events takes (userId, startTime, endTime); we fan out
        // across users with bounded concurrency. Per-user failures are
        // swallowed so one bad user doesn't blank the chart.
        send({ type: "progress", message: "Cargando citas…" });
        const appointments: Appointment[] = [];
        try {
          const now = Date.now();
          const startTime = new Date(now - 90 * 86_400_000).toISOString();
          const endTime = new Date(now).toISOString();
          const userIds = Array.from(userMap.keys());

          const CONCURRENCY_APPT = 6;
          let apptCursor = 0;
          const apptBatches: GHLCalendarEvent[][] = new Array(userIds.length);
          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY_APPT, userIds.length) }, async () => {
              while (apptCursor < userIds.length) {
                const idx = apptCursor++;
                const userId = userIds[idx];
                try {
                  const resp = await getCalendarEvents({ userId, startTime, endTime });
                  apptBatches[idx] = resp.events ?? [];
                } catch (err) {
                  console.error(`[GHL] Calendar events fetch failed for user ${userId}:`, err);
                  apptBatches[idx] = [];
                }
              }
            })
          );

          // Dedupe by event id, then transform.
          const seen = new Set<string>();
          for (const batch of apptBatches) {
            if (!batch) continue;
            for (const ev of batch) {
              if (seen.has(ev.id)) continue;
              seen.add(ev.id);
              const advisorId = ev.assignedUserId;
              const advisorName = advisorId && userMap.has(advisorId)
                ? userMap.get(advisorId)
                : advisorId;
              appointments.push({
                id: ev.id,
                contactId: ev.contactId,
                assignedTo: advisorName,
                title: ev.title,
                startTime: ev.startTime,
                endTime: ev.endTime,
                status: (ev.appointmentStatus ?? "").toLowerCase() || "sin estado",
                notes: ev.notes,
              });
            }
          }
        } catch (err) {
          console.error("[GHL] Appointments fetch failed:", err);
        }

```

- [ ] **Step 3: Add `appointments` to the streamed `data` payload**

Find the `send({ type: "data", ...` block (around `route.ts:379-400`). Add `appointments,` to it. The block should look like:

```ts
        send({
          type: "data",
          contacts,
          opportunities,
          calls,
          tasks,
          messages,
          appointments,
          pipelines: pipelineList,
          members,
          tags: Array.from(tagSet),
          campaigns: Array.from(campaignSet),
          sources: Array.from(sourceSet),
          pautas,
          locationId: process.env.GHL_LOCATION_ID ?? "",
          meta: {
            totalContacts: contacts.length,
            totalOpportunities: opportunities.length,
            totalMessages: messages.length,
            fetchedAt: new Date().toISOString(),
            debugAttribution,
          },
        });
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean. If lint complains about the unused `GHLCalendarEvent` import in any scenario, leave it — it is used in the typed batch array.

- [ ] **Step 5: Manual smoke test of the endpoint**

Start the dev server in a separate terminal: `npm run dev`
In another terminal:
```bash
curl -s -N http://localhost:3000/api/dashboard | tail -n 1 | jq '.appointments | length, .appointments[0]'
```
Expected: a number (e.g. `42`) followed by an Appointment-shaped object with `id`, `contactId`, `assignedTo`, `status`, etc. If GHL credentials are missing or fail entirely, expect `0` and `null` — that's still a pass for this task (the chart will just render its empty state).

- [ ] **Step 6: Commit**

```bash
git add app/api/dashboard/route.ts
git commit -m "feat(api): fetch GHL appointments per asesor over 90-day window"
```

---

## Task 4: Add `appointments` to the `DashboardData` type

**Files:**
- Modify: `hooks/use-dashboard-data.ts:14-33`

- [ ] **Step 1: Update the imports and interface**

In `hooks/use-dashboard-data.ts`, add `Appointment` to the imported types (lines 4–12):

```ts
import type {
  Contact,
  Opportunity,
  Call,
  Task,
  Message,
  Pipeline,
  Pauta,
  Appointment,
} from "@/lib/types";
```

Add `appointments: Appointment[];` to the `DashboardData` interface. The interface (lines 14–33) becomes:

```ts
export interface DashboardData {
  contacts: Contact[];
  opportunities: Opportunity[];
  calls: Call[];
  tasks: Task[];
  messages: Message[];
  appointments: Appointment[];
  pipelines: Pipeline[];
  members: string[];
  tags: string[];
  campaigns: string[];
  sources: string[];
  pautas: Pauta[];
  locationId: string;
  meta: {
    totalContacts: number;
    totalOpportunities: number;
    totalMessages: number;
    fetchedAt: string;
  };
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-dashboard-data.ts
git commit -m "feat(hook): add appointments to DashboardData type"
```

---

## Task 5: Add `filterAppointments` helper

**Files:**
- Modify: `lib/filter-helpers.ts`

- [ ] **Step 1: Add the helper and update imports**

In `lib/filter-helpers.ts`, update the type import (line 1):

```ts
import type { Contact, Opportunity, Call, Message, Appointment } from "./types"
```

Append this function to the end of the file:

```ts
export function filterAppointments(appointments: Appointment[], filters: Filters): Appointment[] {
  return appointments.filter((a) => {
    if (filters.members.length > 0 && a.assignedTo && !filters.members.includes(a.assignedTo)) return false
    return true
  })
}
```

This mirrors `filterCalls` and `filterMessages`: only the `members` filter applies. Pipeline, tags, search, and date range are intentionally not applied to appointments — they don't map meaningfully (see spec).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/filter-helpers.ts
git commit -m "feat(filter): add filterAppointments by asesor"
```

---

## Task 6: Build the AppointmentDrillDrawer component

**Files:**
- Create: `components/dashboard/appointment-drill-drawer.tsx`

- [ ] **Step 1: Create the new file**

Create `components/dashboard/appointment-drill-drawer.tsx` with this full content:

```tsx
"use client"

import { motion } from "framer-motion"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import type { Appointment, Contact } from "@/lib/types"
import { CalendarCheck, CalendarX, CalendarClock, User } from "lucide-react"

export interface ApptDrillState {
  open: boolean
  title: string
  appointments: Appointment[]
}

export const APPT_DRILL_CLOSED: ApptDrillState = { open: false, title: "", appointments: [] }

interface AppointmentDrillDrawerProps {
  drill: ApptDrillState
  onDrillChange: (d: ApptDrillState) => void
  contacts: Contact[]
}

function statusVisual(status: string): {
  Icon: typeof CalendarCheck
  iconBg: string
  iconColor: string
  badgeClass: string
} {
  const s = status.toLowerCase()
  if (s === "showed" || s === "confirmed") {
    return {
      Icon: CalendarCheck,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    }
  }
  if (s === "noshow" || s === "no_show" || s === "cancelled") {
    return {
      Icon: CalendarX,
      iconBg: "bg-red-100",
      iconColor: "text-red-500",
      badgeClass: "bg-red-50 text-red-600 border-red-200",
    }
  }
  return {
    Icon: CalendarClock,
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  }
}

export function AppointmentDrillDrawer({
  drill,
  onDrillChange,
  contacts,
}: AppointmentDrillDrawerProps) {
  const contactById = new Map(contacts.map((c) => [c.id, c]))
  const sorted = [...drill.appointments].sort((a, b) =>
    b.startTime.localeCompare(a.startTime)
  )
  const count = drill.appointments.length

  return (
    <Sheet open={drill.open} onOpenChange={(o) => onDrillChange({ ...drill, open: o })}>
      <SheetContent className="w-[500px] sm:max-w-[500px] p-0 flex flex-col overflow-hidden">
        <div className="border-b border-border px-6 pt-5 pb-4 flex-none">
          <SheetHeader>
            <SheetTitle className="text-[15px] font-semibold leading-snug pr-6">
              {drill.title}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-2.5 flex items-center gap-2">
            <Badge variant="secondary" className="rounded-full text-xs font-semibold tabular-nums">
              {count.toLocaleString()} cita{count !== 1 ? "s" : ""}
            </Badge>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {count === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Sin citas en este segmento.
            </div>
          ) : (
            sorted.map((appt, i) => {
              const contact = contactById.get(appt.contactId)
              const { Icon, iconBg, iconColor, badgeClass } = statusVisual(appt.status)
              const start = new Date(appt.startTime)
              const dateStr = start.toLocaleDateString("es-MX", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
              const timeStr = start.toLocaleTimeString("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
              })
              return (
                <motion.div
                  key={appt.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.025, 0.4), duration: 0.18 }}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                >
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${iconBg}`}>
                    <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
                  </div>
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground truncate">
                        {contact?.name ?? "Contacto desconocido"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {appt.title ?? "Cita"}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <span>{dateStr}</span>
                      <span>{timeStr}</span>
                    </div>
                    {appt.notes && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {appt.notes}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] shrink-0 capitalize ${badgeClass}`}
                  >
                    {appt.status}
                  </Badge>
                </motion.div>
              )
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

This drawer is self-contained: it does NOT open the `DetailDrawer` on contact click. That keeps it simple and matches the YAGNI scope in the spec. (If the user later wants click-to-open-contact, we'll add it then.)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean. The file is new, so no rule violations are expected.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/appointment-drill-drawer.tsx
git commit -m "feat(drawer): add AppointmentDrillDrawer for chart segment drill-down"
```

---

## Task 7: Render the chart in `SalesDashboard`

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Update imports**

In `components/dashboard/sales-dashboard.tsx`, update the type import (line 20):

```ts
import type { Opportunity, Contact, Call, Message, Task, Appointment } from "@/lib/types"
```

Add an import for the new drawer just below the `ChartDrillDrawer` import (after line 22):

```ts
import {
  AppointmentDrillDrawer,
  APPT_DRILL_CLOSED,
  type ApptDrillState,
} from "./appointment-drill-drawer"
```

- [ ] **Step 2: Add the prop**

Update `SalesDashboardProps` (lines 30–38) to include `appointments`:

```ts
interface SalesDashboardProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  calls: Call[]
  messages: Message[]
  appointments: Appointment[]
  tasks?: Task[]
  members?: string[]
  locationId?: string
}
```

Update the destructuring on line 151:

```ts
export function SalesDashboard({ opportunities, contacts, calls, messages = [], appointments = [], tasks = [], members: membersProp = [], locationId = "" }: SalesDashboardProps) {
```

- [ ] **Step 3: Add the status config and drawer state**

Immediately after the existing `WIN_LOSS_CONFIG` block (around line 59) add:

```ts
const APPT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  showed:    { label: "Asistió",    color: "#10b981" },
  confirmed: { label: "Confirmada", color: "#3b82f6" },
  new:       { label: "Pendiente",  color: "#f59e0b" },
  noshow:    { label: "No asistió", color: "#ef4444" },
  cancelled: { label: "Cancelada",  color: "#94a3b8" },
  invalid:   { label: "Inválida",   color: "#a855f7" },
}

const KNOWN_APPT_STATUS_ORDER = ["showed", "confirmed", "new", "noshow", "cancelled", "invalid"]

function apptStatusVisual(status: string, fallbackIndex: number): { label: string; color: string } {
  const known = APPT_STATUS_CONFIG[status]
  if (known) return known
  return {
    label: status.charAt(0).toUpperCase() + status.slice(1),
    color: COLOR_PALETTE[fallbackIndex % COLOR_PALETTE.length],
  }
}
```

Inside the `SalesDashboard` component, just after the existing `const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)` line (line 152), add:

```ts
  const [apptDrill, setApptDrill] = useState<ApptDrillState>(APPT_DRILL_CLOSED)
```

- [ ] **Step 4: Add the aggregation**

Add this `useMemo` block alongside the other `useMemo`s. A good location is right after `responseTimeData` (around line 449), before `chartData`:

```ts
  const apptByStatusByAdvisor = useMemo(() => {
    const memberMap = new Map<string, Map<string, number>>()
    const statusSet = new Set<string>()
    for (const appt of appointments) {
      if (!appt.assignedTo) continue
      statusSet.add(appt.status)
      if (!memberMap.has(appt.assignedTo)) memberMap.set(appt.assignedTo, new Map())
      const row = memberMap.get(appt.assignedTo)!
      row.set(appt.status, (row.get(appt.status) ?? 0) + 1)
    }

    const statuses = [...statusSet].sort((a, b) => {
      const ai = KNOWN_APPT_STATUS_ORDER.indexOf(a)
      const bi = KNOWN_APPT_STATUS_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })

    const data = [...memberMap.entries()]
      .map(([member, statusCounts]) => {
        const row: Record<string, string | number> = { member }
        let total = 0
        for (const status of statuses) {
          const n = statusCounts.get(status) ?? 0
          row[status] = n
          total += n
        }
        row._total = total
        return row
      })
      .sort((a, b) => (b._total as number) - (a._total as number))

    return { data, statuses, total: appointments.filter((a) => a.assignedTo).length }
  }, [appointments])

  const apptChartConfig = useMemo(
    () => Object.fromEntries(
      apptByStatusByAdvisor.statuses.map((status, i) => [
        status,
        apptStatusVisual(status, i),
      ])
    ),
    [apptByStatusByAdvisor.statuses]
  )
```

- [ ] **Step 5: Add the chart card**

Find the closing of the "Actividad de Conversaciones" section's last `<Card>` (the "Conversaciones únicas por asesor" card, ending around line 985 — look for the line `</Card>` followed by the next section header `{/* ── Análisis de Pérdidas ─...`).

Insert this block **between** that closing `</Card>` and the next `<SectionHeader title="Análisis de Pérdidas" />`:

```tsx
      {/* ── Citas ──────────────────────────────────── */}
      <SectionHeader title="Citas" />
      <Card>
        <CardHeader className="flex flex-row items-center pb-2">
          <CardTitle className="text-base font-semibold flex items-center">
            Citas por estatus por asesor
            <InfoTooltip content="Citas (calendar events) por estatus, agrupadas por el asesor asignado. Ventana fija: últimos 90 días." />
          </CardTitle>
          <TotalBadge value={apptByStatusByAdvisor.total} />
        </CardHeader>
        <CardContent>
          {apptByStatusByAdvisor.data.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Sin citas para mostrar
            </div>
          ) : (
            <>
              <ChartContainer
                config={apptChartConfig}
                style={{ height: 320 }}
                className="w-full"
              >
                <BarChart
                  data={apptByStatusByAdvisor.data}
                  margin={{ left: 8, right: 8, top: 16, bottom: apptByStatusByAdvisor.data.length > 6 ? 56 : 32 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="member"
                    tick={{ fontSize: 11 }}
                    angle={apptByStatusByAdvisor.data.length > 6 ? -35 : 0}
                    textAnchor={apptByStatusByAdvisor.data.length > 6 ? "end" : "middle"}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  {apptByStatusByAdvisor.statuses.map((status, i) => (
                    <Bar
                      key={status}
                      dataKey={status}
                      stackId="appt"
                      fill={apptChartConfig[status]?.color ?? COLOR_PALETTE[i % COLOR_PALETTE.length]}
                      radius={
                        i === apptByStatusByAdvisor.statuses.length - 1
                          ? [3, 3, 0, 0]
                          : [0, 0, 0, 0]
                      }
                      cursor="pointer"
                      onClick={(data: any) => {
                        const member = data.member as string
                        const matched = appointments.filter(
                          (a) => a.assignedTo === member && a.status === status
                        )
                        setApptDrill({
                          open: true,
                          title: `${member} · ${apptChartConfig[status]?.label ?? status}`,
                          appointments: matched,
                        })
                      }}
                    />
                  ))}
                </BarChart>
              </ChartContainer>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                Haz clic en un segmento para ver las citas
              </p>
            </>
          )}
        </CardContent>
      </Card>

```

- [ ] **Step 6: Mount the appointment drill drawer**

At the bottom of `SalesDashboard`, immediately before the existing `<ChartDrillDrawer ... />` block (around line 1047), add:

```tsx
      <AppointmentDrillDrawer
        drill={apptDrill}
        onDrillChange={setApptDrill}
        contacts={contacts}
      />
```

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add Citas por estatus por asesor chart"
```

---

## Task 8: Thread `appointments` through `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Import the new filter helper**

Update the filter-helpers import (line 11) to include `filterAppointments`:

```ts
import { filterOpportunities, filterContacts, filterCalls, filterMessages, filterAppointments } from "@/lib/filter-helpers"
```

- [ ] **Step 2: Pull `appointments` out of data**

Just after the existing `const messages = data?.messages ?? []` line (line 73), add:

```ts
  const appointments = data?.appointments ?? []
```

- [ ] **Step 3: Memoize the filtered appointments**

After the existing `filteredMessages` `useMemo` (lines 107–110), add:

```ts
  const filteredAppointments = useMemo(
    () => filterAppointments(appointments, filters),
    [appointments, filters]
  )
```

- [ ] **Step 4: Pass to `<SalesDashboard>`**

In the `activeTab === "sales"` branch (lines 277–285), add the `appointments` prop. The block becomes:

```tsx
        ) : activeTab === "sales" ? (
          <SalesDashboard
            opportunities={filteredOpportunities}
            contacts={filteredContacts}
            calls={filteredCalls}
            messages={filteredMessages}
            appointments={filteredAppointments}
            tasks={data?.tasks ?? []}
            members={availableMembers}
            locationId={data?.locationId ?? ""}
          />
```

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat(page): pass filtered appointments to SalesDashboard"
```

---

## Task 9: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server up on `http://localhost:3000` without compile errors.

- [ ] **Step 2: Verify the chart renders**

Open `http://localhost:3000` in a browser, switch to the **Ventas** tab.

Expected:
- After the loading screen finishes, scroll down past "Actividad de Conversaciones".
- A new "Citas" section header appears.
- Below it, a card titled "Citas por estatus por asesor" with a stacked vertical bar chart and a total badge.
- If GHL has no appointments, the empty state "Sin citas para mostrar" is shown — that is still a pass.

- [ ] **Step 3: Verify segment click opens the drawer**

Click any segment of the chart (assuming non-empty data).

Expected:
- A right-side drawer opens with title `<asesor> · <status label>`.
- One card per matching appointment, sorted newest first.
- Status badge and icon match the segment color/status.
- Closing the drawer (click outside or hit Esc) restores normal interaction.

If the dataset is empty, manually verify by editing the empty-state branch temporarily or trust the per-component review — note the dataset state in the commit/PR description.

- [ ] **Step 4: Verify asesor filter integration**

In the top filter bar, select a single member.

Expected:
- The Citas chart now shows only that member's column.
- Switching the filter to a different member updates the chart accordingly.
- Clearing the member filter restores all asesores.

- [ ] **Step 5: Lint one more time + production build smoke**

Run:
```bash
npm run lint
npm run build
```
Expected: lint clean, build succeeds.

- [ ] **Step 6: Final commit (only if anything was tweaked during verification)**

If verification surfaced an issue and you fixed it, commit the fix with a focused message. Otherwise, skip this step.

---

## Self-Review Notes

**Spec coverage:**
- "All appointments in the location" → Task 3 fetches per-user via `/calendars/events`.
- "Fixed 90-day window" → Task 3 sets `startTime = now − 90d`.
- "Stacked vertical bar, asesor on X axis" → Task 7, chart card block.
- "All distinct statuses found in the data" → Task 7, `KNOWN_APPT_STATUS_ORDER` puts known ones first then unknowns alphabetically; `apptStatusVisual` falls back to palette for unknowns.
- "Click → list of appointments (date, contact, title)" → Task 6 (drawer) + Task 7 segment `onClick`.
- "Asesor filter respected" → Task 5 (`filterAppointments`) + Task 8 (`filteredAppointments`).
- "Section header 'Citas' between Actividad de Conversaciones and Análisis de Pérdidas" → Task 7, Step 5 placement.
- "Per-user GHL fetch failure swallowed" → Task 3, inner try/catch per user.
- "If everything fails, chart renders empty state" → Task 7, `apptByStatusByAdvisor.data.length === 0` branch.

**Type consistency check:**
- `Appointment` interface (Task 1) matches the shape constructed in Task 3 and consumed in Tasks 5–8.
- `ApptDrillState` / `APPT_DRILL_CLOSED` defined in Task 6, imported in Task 7.
- `appointments` prop added to `SalesDashboardProps` in Task 7 matches what `app/page.tsx` passes in Task 8.

**Placeholder scan:** no TBDs, no "implement later", no "similar to Task N".
