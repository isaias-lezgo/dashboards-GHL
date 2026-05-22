# Design: Sales Dashboard — Conversation Charts

**Date:** 2026-05-22  
**Status:** Approved

---

## Summary

Add two new charts to the sales dashboard:
1. **Conversaciones únicas por día** — daily count of distinct conversation threads with activity
2. **Tiempo promedio de respuesta del asesor** — average advisor response time (last 30 conversations, business hours only)

Chart 3 (Tasa de cierre) was discarded as redundant with the existing Win/Loss chart.

---

## 1. Data Layer Changes

### `route.ts`
Replace the current "first 5 contacts" loop with a direct fetch of the last 30 active conversations:

```
getConversations({ limit: 30 })  // no contactId filter
→ for each conversation, getMessages(conv.id, { limit: 50 })
→ transform each message with ghlMessageToInternal(msg, conv.contactId)
```

This provides a representative sample of recent activity without per-contact iteration.

### `lib/types.ts`
Add `conversationId?: string` to the `Message` interface. This is required to group messages into threads for response-time calculation — without it, multiple conversations from the same contact would be merged incorrectly.

### `lib/mock-data.ts`
Enrich existing mock messages with:
- `conversationId` field on each message
- Coverage across more contacts (not just first 5)
- Realistic inbound/outbound pairs with timestamp deltas that exercise the response-time algorithm
- Dates spread across the last 30 days

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
For the last 30 loaded conversations, calculate per-advisor: average time between an inbound message and the next outbound message in the same thread, counting only intervals that start within business hours.

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

## 4. Layout Summary

```
[ existing KPI cards ]
[ Leads por Miembro por Etapa del Pipeline ]

── Rendimiento Individual ──────────────────
[ Win/Loss por Asesor ]  [ Ingreso Ganado por Asesor ]
[ Tiempo promedio de respuesta del asesor  (full width) ]

── Salud del Pipeline ──────────────────────
[ Valor en Pipeline ]  [ Nuevas Oportunidades ]

── Actividad de Conversaciones ─────────────
[ Conversaciones únicas por día  (full width) ]

── Análisis de Pérdidas ────────────────────
[ Razones de Pérdida por Asesor ]
```

---

## 5. Files to Change

| File | Change |
|------|--------|
| `lib/types.ts` | Add `conversationId?: string` to `Message` |
| `lib/mock-data.ts` | Enrich messages with conversationId + more coverage |
| `app/api/dashboard/route.ts` | Replace 5-contact loop with 30-conversation fetch |
| `components/dashboard/sales-dashboard.tsx` | Add 2 new charts + new section header |

No new files needed. No changes to `SalesDashboardProps` — `messages` is already a prop.
