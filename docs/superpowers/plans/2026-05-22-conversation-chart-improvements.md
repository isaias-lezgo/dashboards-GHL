# Conversation Chart Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an info tooltip to the "Conversaciones únicas por día" chart and a new "Conversaciones únicas por asesor" bar chart, both in the existing "Actividad de Conversaciones" section.

**Architecture:** Both changes are purely client-side in `sales-dashboard.tsx`. The info icon uses a native `title` attribute (no tooltip library). The new chart adds one `useMemo` that groups the existing `messages[]` prop by conversation thread and attributes each thread to an advisor.

**Tech Stack:** React, Recharts, lucide-react, shadcn/ui, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `components/dashboard/sales-dashboard.tsx` | Add `Info` to lucide import, info icon on existing card title, new `convByAdvisorData` useMemo, new card + chart |

---

## Task 1: Add info icon to "Conversaciones únicas por día"

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add `Info` to the lucide-react import**

Find the existing lucide import (line ~21):

```typescript
import { Users, TrendingUp, Target, DollarSign } from "lucide-react"
```

Replace with:

```typescript
import { Users, TrendingUp, Target, DollarSign, Info } from "lucide-react"
```

- [ ] **Step 2: Add the info icon inside the CardTitle**

Find the existing CardTitle for the "Conversaciones únicas por día" card (around line 792):

```tsx
          <CardTitle className="text-base font-semibold">
            Conversaciones únicas por día
          </CardTitle>
```

Replace with:

```tsx
          <CardTitle className="text-base font-semibold flex items-center gap-1">
            Conversaciones únicas por día
            <Info
              size={14}
              className="text-muted-foreground cursor-help shrink-0"
              title="Cuenta hilos de conversación distintos que tuvieron al menos un mensaje ese día, sin importar el canal ni la hora."
            />
          </CardTitle>
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | grep "sales-dashboard" | head -10
```

Expected: no output (no errors in this file).

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add info tooltip to Conversaciones únicas por día chart"
```

---

## Task 2: Add "Conversaciones únicas por asesor" chart

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add the `convByAdvisorData` useMemo**

After the `dailyConvData` useMemo (around line 324, before the `responseTimeData` useMemo), insert:

```typescript
  const convByAdvisorData = useMemo(() => {
    const threads = new Map<string, typeof messages>()
    for (const msg of messages) {
      if (!msg.conversationId) continue
      if (!threads.has(msg.conversationId)) threads.set(msg.conversationId, [])
      threads.get(msg.conversationId)!.push(msg)
    }
    for (const thread of threads.values()) {
      thread.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }

    const advisorConvs = new Map<string, Set<string>>()
    for (const [convId, thread] of threads.entries()) {
      const advisor =
        thread.find((m) => m.direction === "outbound" && m.kind !== "activity")?.assignedTo
        ?? thread[0]?.assignedTo
      if (!advisor) continue
      if (!advisorConvs.has(advisor)) advisorConvs.set(advisor, new Set())
      advisorConvs.get(advisor)!.add(convId)
    }

    return [...advisorConvs.entries()]
      .map(([member, convSet]) => ({ member, count: convSet.size }))
      .sort((a, b) => b.count - a.count)
  }, [messages])
```

- [ ] **Step 2: Add the new chart card**

In the JSX, find the closing `</Card>` of the "Conversaciones únicas por día" card (around line 827), right before the `{/* ── Análisis de Pérdidas */}` comment. Insert the new card **after** the existing card's `</Card>`:

```tsx
      <Card>
        <CardHeader className="flex flex-row items-center pb-2">
          <CardTitle className="text-base font-semibold">
            Conversaciones únicas por asesor
          </CardTitle>
          <TotalBadge value={convByAdvisorData.reduce((s, d) => s + d.count, 0)} />
        </CardHeader>
        <CardContent>
          {convByAdvisorData.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Sin datos de conversaciones
            </div>
          ) : (
            <ChartContainer
              config={{ count: { label: "Conversaciones", color: "#06b6d4" } }}
              style={{ height: Math.max(220, convByAdvisorData.length * 48) }}
              className="w-full"
            >
              <BarChart
                data={convByAdvisorData}
                margin={{ left: 8, right: 8, top: 16, bottom: 32 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="member" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="#06b6d4" radius={[3, 3, 0, 0]}>
                  <LabelList
                    dataKey="count"
                    position="top"
                    style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 3: Verify types and lint**

```bash
npx tsc --noEmit 2>&1 | grep "sales-dashboard" | head -10
npm run lint 2>&1 | grep "sales-dashboard" | head -10
```

Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add Conversaciones únicas por asesor chart"
```
