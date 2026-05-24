# Citas por mes por asesor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Citas por estatus por asesor" chart (asesor on X axis, stacked by status) with a grouped+stacked chart where X axis is months, each month has one stacked bar per asesor, and segments within each bar are appointment statuses.

**Architecture:** Single-file change in `components/dashboard/sales-dashboard.tsx`. Replace the `apptByStatusByAdvisor` useMemo and `apptChartConfig` useMemo with a new `apptByMonthByAdvisor` useMemo that pivots by month. Replace the chart JSX entirely. Reuse existing `apptDrill`/`setApptDrill` state and `AppointmentDrillDrawer` unchanged.

**Tech Stack:** React `useMemo`, Recharts (`BarChart`, `Bar`, `XAxis`, `YAxis`, `Legend`, `CartesianGrid`), shadcn `ChartContainer` / `ChartTooltip` / `ChartTooltipContent`.

---

### Task 1: Replace the data aggregation useMemos

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx:478-523`

- [ ] **Step 1: Replace `apptByStatusByAdvisor` and `apptChartConfig` useMemos**

Find and replace the two useMemos (lines 478–523) with the following single useMemo:

```tsx
  const apptByMonthByAdvisor = useMemo(() => {
    const monthMap = new Map<string, Map<string, Map<string, number>>>()
    // monthMap: month → advisor → status → count
    const advisorSet = new Set<string>()
    const statusSet = new Set<string>()
    let total = 0

    for (const appt of appointments) {
      if (!appt.assignedTo) continue
      const month = appt.startTime.slice(0, 7) // "YYYY-MM"
      const advisor = appt.assignedTo
      const status = appt.status
      advisorSet.add(advisor)
      statusSet.add(status)
      total++
      if (!monthMap.has(month)) monthMap.set(month, new Map())
      const advisorMap = monthMap.get(month)!
      if (!advisorMap.has(advisor)) advisorMap.set(advisor, new Map())
      const statusMap = advisorMap.get(advisor)!
      statusMap.set(status, (statusMap.get(status) ?? 0) + 1)
    }

    const advisors = [...advisorSet].sort()
    const statuses = [...statusSet].sort((a, b) => {
      const ai = KNOWN_APPT_STATUS_ORDER.indexOf(a)
      const bi = KNOWN_APPT_STATUS_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })

    const months = [...monthMap.keys()].sort()
    const data = months.map((month) => {
      const [y, m] = month.split("-").map(Number)
      const label = new Date(y, m - 1, 1).toLocaleDateString("es-MX", {
        month: "short",
        year: "numeric",
      })
      const row: Record<string, string | number> = { month, label }
      for (const advisor of advisors) {
        for (const status of statuses) {
          row[`${advisor}_${status}`] =
            monthMap.get(month)?.get(advisor)?.get(status) ?? 0
        }
      }
      return row
    })

    return { data, advisors, statuses, total }
  }, [appointments])

  const apptChartConfig = useMemo(
    () =>
      Object.fromEntries(
        apptByMonthByAdvisor.advisors.flatMap((advisor) =>
          apptByMonthByAdvisor.statuses.map((status, si) => [
            `${advisor}_${status}`,
            {
              label: `${advisor} · ${apptStatusVisual(status, si).label}`,
              color: apptStatusVisual(status, si).color,
            },
          ])
        )
      ),
    [apptByMonthByAdvisor.advisors, apptByMonthByAdvisor.statuses]
  )
```

- [ ] **Step 2: Verify lint passes**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run lint 2>&1 | head -40
```

Expected: no new errors related to `apptByStatusByAdvisor` or `apptChartConfig`.

- [ ] **Step 3: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add components/dashboard/sales-dashboard.tsx && git commit -m "refactor(sales): replace apptByStatusByAdvisor with apptByMonthByAdvisor pivot"
```

---

### Task 2: Replace the chart JSX

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx` — the "Citas" section card (around line 1063)

- [ ] **Step 1: Replace the entire Citas card JSX**

Find the block starting with `{/* ── Citas ──` and ending just before `{/* ── Análisis de Pérdidas`. Replace the inner `<Card>` (the one with title "Citas por estatus por asesor") with:

```tsx
      <Card>
        <CardHeader className="flex flex-row items-center pb-2">
          <CardTitle className="text-base font-semibold flex items-center">
            Citas por mes por asesor
            <InfoTooltip content="Citas (calendar events) agrupadas por mes. Cada mes muestra una barra por asesor, desglosada por estatus. Ventana fija: últimos 90 días." />
          </CardTitle>
          <TotalBadge value={apptByMonthByAdvisor.total} />
        </CardHeader>
        <CardContent>
          {apptByMonthByAdvisor.data.length === 0 ? (
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
                  data={apptByMonthByAdvisor.data}
                  margin={{ left: 8, right: 8, top: 16, bottom: 32 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend
                    content={() => (
                      <div className="flex flex-wrap gap-3 justify-center pt-2">
                        {apptByMonthByAdvisor.statuses.map((status, i) => {
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
                  {apptByMonthByAdvisor.advisors.flatMap((advisor) =>
                    apptByMonthByAdvisor.statuses.map((status, si) => (
                      <Bar
                        key={`${advisor}_${status}`}
                        dataKey={`${advisor}_${status}`}
                        stackId={advisor}
                        fill={apptStatusVisual(status, si).color}
                        name={`${advisor} · ${apptStatusVisual(status, si).label}`}
                        legendType="none"
                        cursor="pointer"
                        radius={
                          si === apptByMonthByAdvisor.statuses.length - 1
                            ? [3, 3, 0, 0]
                            : [0, 0, 0, 0]
                        }
                        onClick={(data: any) => {
                          const matched = appointments.filter(
                            (a) =>
                              a.assignedTo === advisor &&
                              a.startTime.slice(0, 7) === (data.month as string) &&
                              a.status === status
                          )
                          setApptDrill({
                            open: true,
                            title: `${advisor} · ${apptStatusVisual(status, si).label} · ${data.label as string}`,
                            appointments: matched,
                          })
                        }}
                      />
                    ))
                  )}
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

- [ ] **Step 2: Verify lint passes**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run lint 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add components/dashboard/sales-dashboard.tsx && git commit -m "feat(sales): replace citas chart with grouped+stacked by month per asesor"
```

---

### Task 3: Manual validation

**Files:** none (browser verification only)

- [ ] **Step 1: Start the dev server**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run dev
```

Open `http://localhost:3000` and navigate to the **Ventas** tab.

- [ ] **Step 2: Verify chart renders correctly**

Confirm:
- Chart title reads "Citas por mes por asesor".
- X axis shows month labels (e.g., "abr. 2026", "may. 2026").
- Within each month, there is one bar per asesor (bars side-by-side).
- Each bar is stacked by status segments using the correct colors (green = Asistió, blue = Confirmada, amber = Pendiente, red = No asistió, gray = Cancelada, purple = Inválida).
- Legend at the bottom shows status names with color swatches.

- [ ] **Step 3: Verify click drill-down**

Click a status segment. Confirm:
- The `AppointmentDrillDrawer` opens on the right.
- The drawer title includes asesor name, status label, and month label.
- All listed appointments match the clicked asesor, month, and status.

- [ ] **Step 4: Verify asesor filter**

Apply the asesor filter in the filter bar (select one asesor). Confirm:
- Only that asesor's bar appears in each month group (other asesores' bars disappear).
- The total badge updates accordingly.
