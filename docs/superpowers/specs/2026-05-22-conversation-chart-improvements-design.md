# Design: Conversation Chart Improvements

**Date:** 2026-05-22  
**Status:** Approved

---

## Summary

Two additions to the "Actividad de Conversaciones" section in the sales dashboard:

1. **Info icon tooltip** on the existing "Conversaciones únicas por día" chart explaining the uniqueness criterion
2. **New chart** — "Conversaciones únicas por asesor" — a simple vertical bar chart showing total unique conversation threads per advisor

---

## 1. Info Icon Tooltip

**Target card:** "Conversaciones únicas por día"

**Implementation:** Add a `<Info size={14}>` icon (lucide-react, already installed) next to the `<CardTitle>`. Use the native HTML `title` attribute for the tooltip — no additional library needed.

**Tooltip text:**  
_"Cuenta hilos de conversación distintos que tuvieron al menos un mensaje ese día, sin importar el canal ni la hora."_

**Placement:** Inline after the title text, vertically centered, with a small left margin (`ml-1`). Color: `text-muted-foreground`.

---

## 2. New Chart — Conversaciones únicas por asesor

**Location:** New `<Card>` in the "Actividad de Conversaciones" section, directly below the existing "Conversaciones únicas por día" card.

### Definition
Count the number of distinct `conversationId` values attributed to each advisor, across all loaded messages. An advisor is attributed a conversation based on the `assignedTo` of the first outbound message in that thread. If the thread has no outbound messages, fall back to the `assignedTo` of the first message of any direction.

### Algorithm (client-side `useMemo`)
```
const convByAdvisor = new Map<string, Set<string>>()
// Group messages by conversationId, sort ASC
// For each thread:
//   advisor = assignedTo of first outbound msg
//             ?? assignedTo of first msg (any direction)
//   if advisor: add conversationId to that advisor's Set
// Return: [{ member, count }] sorted desc by count
```

### Visual
- `BarChart` vertical (advisors on X, count on Y)
- Color: `#06b6d4` (same as the per-day chart)
- Height: `Math.max(220, advisors.length * 48)`
- `LabelList` on top of each bar showing the count
- Empty state: "Sin datos de conversaciones"

---

## 3. Files to Change

| File | Change |
|------|--------|
| `components/dashboard/sales-dashboard.tsx` | Add `Info` import, info icon to existing card title, new `useMemo`, new card+chart |
