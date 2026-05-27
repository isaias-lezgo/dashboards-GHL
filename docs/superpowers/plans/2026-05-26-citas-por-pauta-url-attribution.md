# Citas por Pauta (URL Attribution) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-width vertical stacked bar chart to the Marketing Dashboard that shows appointment counts per pauta, attributed by matching the contact's `attributionUrl` against the URL embedded in each pauta's `nombrePauta` field, stacked by appointment status.

**Architecture:** All logic is self-contained in `components/dashboard/marketing-dashboard.tsx`. Two pure helper functions handle URL normalization. One `useMemo` computes the chart data. A new `DashboardCard` with a Recharts `BarChart` renders it below the existing 4a/4b panel row.

**Tech Stack:** Next.js 15, React, Recharts, shadcn/ui chart wrapper, TypeScript

---

## File Map

| File | Change |
|---|---|
| `components/dashboard/marketing-dashboard.tsx` | Add 2 helper functions, 1 useMemo, 1 DashboardCard JSX block |

---

### Task 1: Add URL normalization helpers

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx` (after `shortPautaName` ~line 147)

These two pure functions are the foundation of the attribution logic. Add them immediately after `shortPautaName`.

- [ ] **Step 1: Add the two helper functions**

In `components/dashboard/marketing-dashboard.tsx`, after the closing brace of `shortPautaName` (around line 147), insert:

```typescript
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return (u.hostname + u.pathname).replace(/\/$/, "").toLowerCase()
  } catch {
    return ""
  }
}

function extractPautaUrl(nombrePauta: string): string {
  const parts = nombrePauta.split(" - ").map((s) => s.trim()).filter(Boolean)
  const url = parts[1] ?? ""
  return normalizeUrl(url)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes (TypeScript errors are suppressed per `next.config.mjs`, but watch for obvious parse errors).

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat(marketing): add normalizeUrl and extractPautaUrl helpers"
```

---

### Task 2: Add useMemo to compute appointments-per-pauta data

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx` (after `wonPaidTraffic` useMemo ~line 528)

- [ ] **Step 1: Add the useMemo**

In `marketing-dashboard.tsx`, after the closing of the `wonPaidTraffic` useMemo block (around line 528), insert:

```typescript
const { apptsByPautaRows, apptsByPautaKeys } = useMemo(() => {
  if (appointments.length === 0 || pautas.length === 0) {
    return { apptsByPautaRows: [], apptsByPautaKeys: [] }
  }

  // 1. contactId → normalized attributionUrl
  const contactUrlMap = new Map<string, string>()
  for (const c of contacts) {
    if (c.attributionUrl) {
      const norm = normalizeUrl(c.attributionUrl)
      if (norm) contactUrlMap.set(c.id, norm)
    }
  }

  // 2. normalized URL → first matching pauta name
  const urlToPauta = new Map<string, string>()
  for (const p of pautas) {
    const norm = extractPautaUrl(p.nombrePauta)
    if (norm && !urlToPauta.has(norm)) {
      urlToPauta.set(norm, p.nombrePauta)
    }
  }

  // 3. pautaName → status → count
  const counts = new Map<string, Map<string, number>>()
  const pautaTotals = new Map<string, number>()

  for (const appt of appointments) {
    const normUrl = contactUrlMap.get(appt.contactId)
    if (!normUrl) continue
    const pautaName = urlToPauta.get(normUrl)
    if (!pautaName) continue

    const status = appt.status || "Sin estatus"
    if (!counts.has(pautaName)) counts.set(pautaName, new Map())
    const statusMap = counts.get(pautaName)!
    statusMap.set(status, (statusMap.get(status) ?? 0) + 1)
    pautaTotals.set(pautaName, (pautaTotals.get(pautaName) ?? 0) + 1)
  }

  // 4. Top 20 pautas by total appointment count
  const topPautas = Array.from(pautaTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name]) => name)

  // 5. Status keys sorted by total volume across all pautas
  const statusTotals = new Map<string, number>()
  for (const [, statusMap] of counts) {
    for (const [status, count] of statusMap) {
      statusTotals.set(status, (statusTotals.get(status) ?? 0) + count)
    }
  }
  const statusKeys = Array.from(statusTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)

  // 6. Build rows: one per pauta, columns = status counts
  const rows = topPautas.map((pautaName) => {
    const row: Record<string, string | number> = { pauta: pautaName }
    const statusMap = counts.get(pautaName)!
    for (const k of statusKeys) row[k] = statusMap.get(k) ?? 0
    return row
  })

  return { apptsByPautaRows: rows, apptsByPautaKeys: statusKeys }
}, [appointments, pautas, contacts])
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: completes without parse errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat(marketing): compute appointments-per-pauta via URL attribution"
```

---

### Task 3: Add chart JSX

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx` (after the closing `</div>` of the 4a/4b grid, before `<ChartDrillDrawer>`)

The 4a/4b section ends at the closing `</div>` around line 1249 — it's the `{/* Panel 4a ... */}` grid div. The new card goes between that and `<ChartDrillDrawer`.

- [ ] **Step 1: Insert the new DashboardCard**

After the closing `</div>` of the 4a/4b panels grid and before `<ChartDrillDrawer`, insert:

```tsx
<DashboardCard>
  <ChartCardHeader
    title="Citas por Pauta (atribución URL)"
    total={apptsByPautaRows.reduce(
      (s, r) => s + apptsByPautaKeys.reduce((a, k) => a + ((r[k] as number) || 0), 0),
      0,
    )}
    icon={Calendar}
  />
  <ChartCardContent>
    {apptsByPautaKeys.length === 0 ? (
      <ChartEmpty message="Sin citas atribuidas por URL." height={300} />
    ) : (
      <>
        <ChartContainer
          config={Object.fromEntries(
            apptsByPautaKeys.map((k, i) => [k, { label: k, color: CHART_PALETTE[i % CHART_PALETTE.length] }])
          )}
          className="aspect-auto"
          style={{ height: Math.max(300, apptsByPautaRows.length * 48 + 120) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={apptsByPautaRows}
              margin={{ top: 5, right: 16, left: 8, bottom: 120 }}
              barCategoryGap="20%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
              <XAxis
                dataKey="pauta"
                tick={{ fontSize: 10, fill: CHART_TICK.fill }}
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={-45}
                textAnchor="end"
                tickFormatter={(v: string) => shortPautaName(v)}
              />
              <YAxis
                tick={{ ...CHART_TICK }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <ChartTooltip
                content={
                  <NonZeroTooltipContent
                    labelFormatter={(_: unknown, p: any) => {
                      const name = p?.[0]?.payload?.pauta ?? String(_)
                      return shortPautaName(name)
                    }}
                  />
                }
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={(value) => <span style={{ color: "#374151" }}>{value}</span>}
              />
              {apptsByPautaKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="a"
                  fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                  radius={i === apptsByPautaKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  maxBarSize={40}
                  cursor="pointer"
                  onClick={(data: any) => {
                    const count = data[key] as number
                    if (!count) return
                    const pautaName = data.pauta as string
                    const normUrl = extractPautaUrl(pautaName)
                    const matchedContactIds = new Set(
                      contacts
                        .filter((c) => c.attributionUrl && normalizeUrl(c.attributionUrl) === normUrl)
                        .map((c) => c.id)
                    )
                    const matchedContactIdsForStatus = new Set(
                      appointments
                        .filter(
                          (a) =>
                            matchedContactIds.has(a.contactId) &&
                            (a.status || "Sin estatus") === key,
                        )
                        .map((a) => a.contactId)
                    )
                    openDrill(
                      `${shortPautaName(pautaName)} · ${key}`,
                      opportunities.filter((o) => matchedContactIdsForStatus.has(o.contactId)),
                      `${count} cita${count !== 1 ? "s" : ""} con estatus "${key}"`,
                    )
                  }}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
        <ChartHint>Apilado por estatus · atribución vía URL · haz clic para ver oportunidades</ChartHint>
      </>
    )}
  </ChartCardContent>
</DashboardCard>
```

- [ ] **Step 2: Start the dev server and open the dashboard**

```bash
npm run dev
```

Open `http://localhost:3000` in the browser. Navigate to the Marketing tab. Scroll to the bottom — confirm the "Citas por Pauta (atribución URL)" card appears below the 4a/4b panels.

**If the chart shows data:** Verify bars are stacked by status, X-axis labels use `shortPautaName` format, tooltip shows full pauta name, clicking a segment opens the drill drawer with matching opportunities.

**If the chart shows "Sin citas atribuidas por URL":** This is expected if live GHL data has no URL overlap between `attributionUrl` and pauta names — the empty state is correct behavior.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat(marketing): add Citas por Pauta chart with URL attribution"
```
