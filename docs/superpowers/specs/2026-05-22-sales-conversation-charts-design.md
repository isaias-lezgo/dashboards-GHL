# Design: Sales Dashboard — Conversation Charts

**Date:** 2026-05-22  
**Status:** Approved (revised 2026-05-22 — per-user sampling)

---

## Summary

Add three charts to the sales dashboard:
1. **Conversaciones únicas por día** — daily count of distinct conversation threads with activity
2. **Tiempo promedio de respuesta del asesor** — average advisor response time (last 30 conversations per advisor, business hours only)
3. **Conversaciones únicas por asesor** — monthly stacked breakdown of unique conversations attributed to each advisor

Chart "Tasa de cierre" was discarded as redundant with the existing Win/Loss chart.

---

## 1. Data Layer Changes

### `route.ts`
Fan out conversation fetching per user so every advisor with recent activity appears in the charts (a single `limit: 30` call would surface only the few advisors who happen to own the most recent threads).

```
for each user in userMap (parallel):
  getConversations({ limit: 30, assignedTo: userId })
→ dedupe conversation IDs across users (a reassigned conv can return twice)
→ bounded concurrency (≤6) of getMessages(conv.id, { limit: 50 })
→ transform each message with ghlMessageToInternal, resolving
  assignedTo through userMap so the Message carries the advisor's name
  rather than their GHL user ID
```

Trade-off: with N users the worst case is N×30 message fetches. The
`CONCURRENCY = 6` cap plus the existing 429 retry/backoff in `ghlFetch`
keeps this within rate limits for normal team sizes (≤20 advisors).

### `lib/types.ts`
Add `conversationId?: string` to the `Message` interface. This is required to group messages into threads for response-time calculation — without it, multiple conversations from the same contact would be merged incorrectly.

---

## 2. Chart 1 — Conversaciones únicas por día

**Location:** New section `"Actividad de Conversaciones"` inserted after `"Salud del Pipeline"`.

### Definition
Count distinct `conversationId` values that had at least one message on each calendar day. No business-hours filter — all activity counts regardless of time.

### Algorithm (client-side, `useMemo`)
```
const dailyMap = new Map<string, Set<string>>()  // date → Set<conversationId>
for (const msg of messages) {
  const date = msg.createdAt.slice(0, 10)  // "YYYY-MM-DD"
  if (!dailyMap.has(date)) dailyMap.set(date, new Set())
  if (msg.conversationId) dailyMap.get(date)!.add(msg.conversationId)
}
// Sort by date ASC, map to { date, count }
```

### Visual
- `BarChart` (vertical bars, date on X, count on Y)
- Color: `#06b6d4`
- Height: 220px fixed
- X-axis labels: `"DD MMM"` format (e.g., `"22 May"`)
- Angle labels -35° if more than 10 days shown
- Empty state: `"Sin datos de conversaciones"`

---

## 3. Chart 2 — Tiempo promedio de respuesta del asesor

**Location:** `"Rendimiento Individual"` section, full-width row below the existing Win/Loss + Ingreso Ganado row.

### Definition
Per advisor, average the time between an inbound message and the next outbound message in the same thread, counting only intervals that start within business hours. The sample is the last 30 conversations **per advisor** (see §1) so every advisor with recent activity appears, not just the few who hold the most-recently-touched threads globally. Advisor labels come from `userMap` (names, not IDs).

### Business Hours
- **Timezone:** America/Mexico_City (UTC-6)
- **Hours:** Monday–Friday, 09:00–19:00
- If an inbound message arrives outside business hours, the response clock starts at the next business-hours opening (next weekday 09:00)
- If no outbound reply exists in the same thread → skip that inbound message (no penalty for unanswered threads)

### Algorithm (client-side, `useMemo`)
```
// Group messages by conversationId, sort each group by createdAt ASC
// For each thread:
//   for each inbound message:
//     find next outbound in same thread
//     if found:
//       clockStart = isBusinessHours(inbound.createdAt)
//                    ? inbound.createdAt
//                    : nextBusinessOpen(inbound.createdAt)
//       delta = outbound.createdAt - clockStart  (milliseconds)
//       if delta > 0: push to advisor's deltas array
// Per advisor: avg = sum(deltas) / deltas.length  → convert to minutes
```

### Color Thresholds
- `#10b981` (green) — avg < 30 min
- `#f59e0b` (yellow) — 30–60 min
- `#ef4444` (red) — > 60 min

### Visual
- `BarChart` horizontal (advisors on Y, minutes on X)
- `LabelList` on right: formatted as `"12 min"` or `"1h 20min"`
- Height: `Math.max(200, advisors.length * 64)`
- Empty state: `"Sin datos de respuesta"` if no valid inbound→outbound pairs found

---

## 4. Chart 3 — Conversaciones únicas por asesor

**Location:** `"Actividad de Conversaciones"` section, full-width, directly below `"Conversaciones únicas por día"`.

### Definition
Pivot the loaded thread sample into `month → advisor → unique conversation count`, then render as a stacked bar chart with one stack segment per advisor. The chart answers "how is each advisor's conversation volume trending month over month" rather than "who has the most conversations overall."

### Algorithm (client-side, `useMemo`)
```
// Group messages → threads by conversationId, sort each thread by createdAt ASC
// For each thread:
//   advisor = first outbound non-activity message's assignedTo
//             ?? thread[0].assignedTo
//   month   = thread[0].createdAt.slice(0, 7)   // "YYYY-MM"
//   advisorSet.add(advisor); monthMap[month][advisor]++
// Sort months ASC, advisors alphabetically
// Emit rows: { month, label: localized "mmm yyyy", [advisor]: count, … }
```

### Visual
- `BarChart` with X = month label (`"may 2026"`), Y = unique-conversation count
- One `<Bar stackId="conv">` per advisor, color from `COLOR_PALETTE`
- `<Legend>` to map color → advisor
- Height: 320 px fixed
- Empty state: `"Sin datos de conversaciones"`

---

## 5. Layout Summary

```
[ existing KPI cards ]
[ Leads por Miembro por Etapa del Pipeline ]

── Rendimiento Individual ──────────────────
[ Win/Loss por Asesor ]  [ Ingreso Ganado por Asesor ]
[ Tiempo promedio de respuesta del asesor  (full width) ]

── Salud del Pipeline ──────────────────────
[ Valor en Pipeline ]  [ Nuevas Oportunidades ]

── Actividad de Conversaciones ─────────────
[ Conversaciones únicas por día        (full width) ]
[ Conversaciones únicas por asesor     (full width) ]

── Análisis de Pérdidas ────────────────────
[ Razones de Pérdida por Asesor ]
```

---

## 6. Files to Change

| File | Change |
|------|--------|
| `lib/types.ts` | Add `conversationId?: string` to `Message` |
| `app/api/dashboard/route.ts` | Per-user `getConversations({ limit: 30, assignedTo })` fan-out, dedupe, bounded-concurrency message fetch, resolve `assignedTo` → name via `userMap` |
| `components/dashboard/sales-dashboard.tsx` | Add the 3 new charts + new section header |

No new files needed. No changes to `SalesDashboardProps` — `messages` is already a prop.
