# Advisor Responsibility Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three charts to the Sales dashboard that surface advisor data-hygiene and activity responsibility — campos vacíos por asesor, llamadas por asesor, visitas agendadas vs realizadas.

**Architecture:** Pure client-side additions inside `components/dashboard/sales-dashboard.tsx`. Each chart is a `useMemo` block + a `DashboardCard` JSX block, rendered under a new `SectionHeader` between the existing `"Citas"` and `"Análisis de Pérdidas"` sections. No API, type, mock-data, or route changes. All inputs (`opportunities`, `calls`, `appointments`) are already passed as props.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Recharts (via shadcn chart wrappers), Tailwind v3, existing helpers in `components/dashboard/dashboard-ui.tsx`.

**Project testing note:** Per `CLAUDE.md`, the project has no automated tests. Verification per task = TypeScript compile (`npx tsc --noEmit`) + visual check in `npm run dev` at <http://localhost:3000>. Each task commits independently.

**Spec:** `docs/superpowers/specs/2026-05-26-advisor-responsibility-charts-design.md`

---

## Task 1: Add `Responsabilidad del Asesor` section header + Chart 1 (Campos vacíos por asesor)

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add the `emptyFieldsData` useMemo block**

Insert this `useMemo` block in `SalesDashboard` immediately after the existing `apptByMonthByAdvisor` `useMemo` (around line 523, before `apptChartConfig`). It computes, per advisor:
- average empty standard fields per opp
- average empty custom-field keys per opp
- totals and per-opp emptiness for drill-down sorting

```tsx
  const emptyFieldsData = useMemo(() => {
    const STANDARD_FIELDS = ["value", "source", "notes", "tags", "priority"] as const

    function isStandardEmpty(opp: Opportunity, field: typeof STANDARD_FIELDS[number]): boolean {
      switch (field) {
        case "value":
          return !opp.value || opp.value === 0
        case "tags":
          return !opp.tags || opp.tags.length === 0
        case "source":
        case "notes":
        case "priority": {
          const v = opp[field]
          return v == null || (typeof v === "string" && v.trim() === "")
        }
      }
    }

    const universeCustomKeys = new Set<string>()
    for (const opp of opportunities) {
      if (opp.customFieldsResolved) {
        for (const k of Object.keys(opp.customFieldsResolved)) {
          universeCustomKeys.add(k)
        }
      }
    }
    const customKeys = [...universeCustomKeys]

    function countEmpty(opp: Opportunity): { standard: number; custom: number; total: number } {
      let standard = 0
      for (const f of STANDARD_FIELDS) {
        if (isStandardEmpty(opp, f)) standard++
      }
      let custom = 0
      const cf = opp.customFieldsResolved ?? {}
      for (const k of customKeys) {
        const v = cf[k]
        if (v == null || (typeof v === "string" && v.trim() === "")) custom++
      }
      return { standard, custom, total: standard + custom }
    }

    const byAdvisor = new Map<string, { opps: Opportunity[]; perOpp: Map<string, number>; totalStandard: number; totalCustom: number }>()
    for (const opp of opportunities) {
      if (!opp.assignedTo) continue
      const counts = countEmpty(opp)
      if (!byAdvisor.has(opp.assignedTo)) {
        byAdvisor.set(opp.assignedTo, { opps: [], perOpp: new Map(), totalStandard: 0, totalCustom: 0 })
      }
      const entry = byAdvisor.get(opp.assignedTo)!
      entry.opps.push(opp)
      entry.perOpp.set(opp.id, counts.total)
      entry.totalStandard += counts.standard
      entry.totalCustom += counts.custom
    }

    const rows = [...byAdvisor.entries()].map(([member, entry]) => {
      const n = entry.opps.length
      const avgStandard = n > 0 ? entry.totalStandard / n : 0
      const avgCustom = n > 0 ? entry.totalCustom / n : 0
      return {
        member,
        avgStandard,
        avgCustom,
        avgTotal: avgStandard + avgCustom,
        totalOpps: n,
        totalStandard: entry.totalStandard,
        totalCustom: entry.totalCustom,
        opps: entry.opps,
        perOpp: entry.perOpp,
      }
    })

    rows.sort((a, b) => b.avgTotal - a.avgTotal)

    return { rows, customKeysCount: customKeys.length, standardKeysCount: STANDARD_FIELDS.length }
  }, [opportunities])
```

- [ ] **Step 2: Insert the section header + Chart 1 card in JSX**

Locate the JSX line `<SectionHeader title="Análisis de Pérdidas" />` (currently around line 1104). Immediately **before** that line, insert:

```tsx
      <SectionHeader title="Responsabilidad del Asesor" />

      <DashboardCard>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-semibold leading-snug tracking-tight flex items-center">
            Campos vacíos por asesor
            <InfoTooltip content="Promedio de campos vacíos por oportunidad. Mide qué tan completamente cada asesor llena los datos de sus oportunidades. Considera campos estándar (valor, fuente, notas, tags, prioridad) y todos los custom fields presentes en el dataset." />
          </CardTitle>
          <TotalBadge value={emptyFieldsData.rows.reduce((s, r) => s + r.totalOpps, 0)} />
        </CardHeader>
        <ChartCardContent>
          {emptyFieldsData.rows.length === 0 ? (
            <ChartEmpty message="Sin oportunidades para mostrar" height={192} />
          ) : (
            <>
              <ChartContainer
                config={{
                  avgStandard: { label: "Estándar vacíos", color: STRUCTURAL_NAVY },
                  avgCustom: { label: "Custom vacíos", color: BRAND_AMBER },
                }}
                style={{ height: Math.max(200, emptyFieldsData.rows.length * 64) }}
                className="w-full"
              >
                <BarChart
                  data={emptyFieldsData.rows}
                  layout="vertical"
                  margin={{ left: 8, right: 64, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID_STROKE} />
                  <YAxis dataKey="member" type="category" width={68} tick={{ fontSize: 12 }} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <ChartTooltip
                    content={
                      <NonZeroTooltipContent
                        formatter={(value) =>
                          typeof value === "number" ? value.toFixed(1) : String(value)
                        }
                      />
                    }
                  />
                  <Legend />
                  <Bar
                    dataKey="avgStandard"
                    stackId="empty"
                    fill={STRUCTURAL_NAVY}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const row = emptyFieldsData.rows.find((r) => r.member === data.member)
                      if (!row) return
                      const sorted = [...row.opps].sort(
                        (a, b) => (row.perOpp.get(b.id) ?? 0) - (row.perOpp.get(a.id) ?? 0)
                      )
                      openDrill(`${row.member} · Oportunidades con campos vacíos`, sorted)
                    }}
                  />
                  <Bar
                    dataKey="avgCustom"
                    stackId="empty"
                    fill={BRAND_AMBER}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const row = emptyFieldsData.rows.find((r) => r.member === data.member)
                      if (!row) return
                      const sorted = [...row.opps].sort(
                        (a, b) => (row.perOpp.get(b.id) ?? 0) - (row.perOpp.get(a.id) ?? 0)
                      )
                      openDrill(`${row.member} · Oportunidades con campos vacíos`, sorted)
                    }}
                  >
                    <LabelList
                      dataKey="avgTotal"
                      position="right"
                      formatter={(v: unknown) =>
                        typeof v === "number" ? `${v.toFixed(1)} vacíos/opp` : ""
                      }
                      style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en una barra para ver las oportunidades</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>
```

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors. If errors mention `data.member` typing on Recharts `onClick`, that matches the existing pattern (`(data: any) =>`) — accepted.

- [ ] **Step 4: Visual check in dev server**

If a dev server is not already running, start one: `npm run dev` (background).
Open <http://localhost:3000>, switch to the Sales tab. Scroll to the new "Responsabilidad del Asesor" section. Verify:
- The "Campos vacíos por asesor" card renders.
- Each advisor has a horizontal stacked bar (navy = estándar, amber = custom).
- The right-edge label shows `X.X vacíos/opp`.
- Rows are sorted with the worst (highest avgTotal) at the top.
- Clicking a bar opens the drill drawer with that advisor's opportunities.
- Tooltip shows the two segments with 1-decimal values.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add 'Campos vacíos por asesor' chart

New Responsabilidad del Asesor section starts with a horizontal stacked
bar chart showing average empty standard and custom opportunity fields
per advisor."
```

---

## Task 2: Add Chart 2 (Llamadas por asesor)

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add the `callsByAdvisorData` useMemo block**

Insert this `useMemo` block immediately after the `emptyFieldsData` block added in Task 1:

```tsx
  const callsByAdvisorData = useMemo(() => {
    const byAdvisor = new Map<
      string,
      { completed: number; missed: number; noAnswer: number; total: number; contactIds: { completed: string[]; missed: string[]; noAnswer: string[] } }
    >()
    for (const c of calls) {
      if (!c.assignedTo) continue
      if (!byAdvisor.has(c.assignedTo)) {
        byAdvisor.set(c.assignedTo, {
          completed: 0,
          missed: 0,
          noAnswer: 0,
          total: 0,
          contactIds: { completed: [], missed: [], noAnswer: [] },
        })
      }
      const entry = byAdvisor.get(c.assignedTo)!
      entry.total++
      if (c.status === "completed") {
        entry.completed++
        entry.contactIds.completed.push(c.contactId)
      } else if (c.status === "missed") {
        entry.missed++
        entry.contactIds.missed.push(c.contactId)
      } else if (c.status === "no-answer") {
        entry.noAnswer++
        entry.contactIds.noAnswer.push(c.contactId)
      }
    }
    const rows = [...byAdvisor.entries()]
      .map(([member, v]) => ({ member, ...v }))
      .sort((a, b) => b.total - a.total)
    const totalCalls = rows.reduce((s, r) => s + r.total, 0)
    return { rows, totalCalls }
  }, [calls])
```

- [ ] **Step 2: Insert Chart 2 JSX after Chart 1**

Locate the closing `</DashboardCard>` of the Chart 1 block added in Task 1 (the "Campos vacíos por asesor" card). Immediately **after** that closing tag, insert:

```tsx
      <DashboardCard>
        <ChartCardHeader title="Llamadas por asesor" total={callsByAdvisorData.totalCalls} />
        <ChartCardContent>
          {callsByAdvisorData.rows.length === 0 ? (
            <ChartEmpty message="Sin llamadas registradas" height={192} />
          ) : (
            <>
              <ChartContainer
                config={{
                  completed: { label: "Completadas", color: "#10b981" },
                  missed: { label: "Perdidas", color: "#ef4444" },
                  noAnswer: { label: "Sin respuesta", color: "#94a3b8" },
                }}
                style={{ height: Math.max(200, callsByAdvisorData.rows.length * 64) }}
                className="w-full"
              >
                <BarChart
                  data={callsByAdvisorData.rows}
                  layout="vertical"
                  margin={{ left: 8, right: 48, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID_STROKE} />
                  <YAxis dataKey="member" type="category" width={68} tick={{ fontSize: 12 }} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Legend />
                  <Bar
                    dataKey="completed"
                    stackId="calls"
                    fill="#10b981"
                    cursor="pointer"
                    onClick={(data: any) =>
                      openDrillContacts(`${data.member} · Completadas`, data.contactIds?.completed ?? [])
                    }
                  />
                  <Bar
                    dataKey="missed"
                    stackId="calls"
                    fill="#ef4444"
                    cursor="pointer"
                    onClick={(data: any) =>
                      openDrillContacts(`${data.member} · Perdidas`, data.contactIds?.missed ?? [])
                    }
                  />
                  <Bar
                    dataKey="noAnswer"
                    stackId="calls"
                    fill="#94a3b8"
                    cursor="pointer"
                    onClick={(data: any) =>
                      openDrillContacts(`${data.member} · Sin respuesta`, data.contactIds?.noAnswer ?? [])
                    }
                  >
                    <LabelList
                      dataKey="total"
                      position="right"
                      formatter={(v: unknown) => (typeof v === "number" ? String(v) : "")}
                      style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en un segmento para ver los contactos</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>
```

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Visual check**

Reload <http://localhost:3000>. In the Sales tab, scroll to "Responsabilidad del Asesor". Verify:
- "Llamadas por asesor" card renders below Chart 1.
- Each advisor has a horizontal stacked bar with green/red/gray segments.
- Total count appears at the right edge as a label.
- Legend shows three labels: Completadas / Perdidas / Sin respuesta.
- Clicking a segment opens the drill drawer with contacts for that status.
- If running against live GHL data with empty calls, the card shows the empty-state message.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add 'Llamadas por asesor' chart

Horizontal stacked bar per advisor breaking down call counts by status
(completed / missed / no-answer). Click drills into contacts for that
advisor+status combination."
```

---

## Task 3: Add Chart 3 (Visitas agendadas vs realizadas por asesor)

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add the `visitFulfillmentData` useMemo block**

Insert this `useMemo` block immediately after the `callsByAdvisorData` block added in Task 2:

```tsx
  const visitFulfillmentData = useMemo(() => {
    const byAdvisor = new Map<string, { agendadas: number; realizadas: number }>()
    for (const a of appointments) {
      if (!a.assignedTo) continue
      if (!byAdvisor.has(a.assignedTo)) byAdvisor.set(a.assignedTo, { agendadas: 0, realizadas: 0 })
      const entry = byAdvisor.get(a.assignedTo)!
      entry.agendadas++
      if (a.status === "showed") entry.realizadas++
    }
    const rows = [...byAdvisor.entries()]
      .filter(([, v]) => v.agendadas > 0)
      .map(([member, v]) => ({
        member,
        agendadas: v.agendadas,
        realizadas: v.realizadas,
        rate: v.agendadas > 0 ? (v.realizadas / v.agendadas) * 100 : 0,
      }))
      .sort((a, b) => b.rate - a.rate)
    const totalAgendadas = rows.reduce((s, r) => s + r.agendadas, 0)
    return { rows, totalAgendadas }
  }, [appointments])
```

- [ ] **Step 2: Insert Chart 3 JSX after Chart 2**

Locate the closing `</DashboardCard>` of the Chart 2 block added in Task 2. Immediately **after** that closing tag, insert:

```tsx
      <DashboardCard>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-semibold leading-snug tracking-tight flex items-center">
            Visitas agendadas vs realizadas
            <InfoTooltip content="Compara visitas agendadas (todas las citas, sin importar estatus) contra realizadas (estatus = 'showed'). La etiqueta muestra la tasa de cumplimiento del asesor." />
          </CardTitle>
          <TotalBadge value={visitFulfillmentData.totalAgendadas} />
        </CardHeader>
        <ChartCardContent>
          {visitFulfillmentData.rows.length === 0 ? (
            <ChartEmpty message="Sin visitas para mostrar" height={192} />
          ) : (
            <>
              <ChartContainer
                config={{
                  agendadas: { label: "Agendadas", color: STRUCTURAL_NAVY },
                  realizadas: { label: "Realizadas", color: BRAND_AMBER },
                }}
                style={{ height: Math.max(200, visitFulfillmentData.rows.length * 80) }}
                className="w-full"
              >
                <BarChart
                  data={visitFulfillmentData.rows}
                  layout="vertical"
                  margin={{ left: 8, right: 56, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID_STROKE} />
                  <YAxis dataKey="member" type="category" width={68} tick={{ fontSize: 12 }} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Legend />
                  <Bar
                    dataKey="agendadas"
                    fill={STRUCTURAL_NAVY}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const matched = appointments.filter((a) => a.assignedTo === data.member)
                      setApptDrill({
                        open: true,
                        title: `${data.member} · Visitas agendadas`,
                        appointments: matched,
                      })
                    }}
                  />
                  <Bar
                    dataKey="realizadas"
                    fill={BRAND_AMBER}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const matched = appointments.filter(
                        (a) => a.assignedTo === data.member && a.status === "showed"
                      )
                      setApptDrill({
                        open: true,
                        title: `${data.member} · Visitas realizadas`,
                        appointments: matched,
                      })
                    }}
                  >
                    <LabelList
                      dataKey="rate"
                      position="right"
                      formatter={(v: unknown) =>
                        typeof v === "number" ? `${v.toFixed(0)}%` : ""
                      }
                      style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en una barra para ver las citas</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>
```

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Visual check**

Reload <http://localhost:3000>. In the Sales tab, scroll to the bottom of the "Responsabilidad del Asesor" section. Verify:
- "Visitas agendadas vs realizadas" card renders below Chart 2.
- Each advisor row has **two side-by-side bars** (not stacked) — navy "Agendadas" and amber "Realizadas".
- Right-edge label shows fulfillment rate as `XX%`.
- Rows sorted by rate descending (best cumplimiento at top).
- Clicking "Agendadas" bar opens `AppointmentDrillDrawer` with all appointments for that advisor.
- Clicking "Realizadas" bar opens drawer filtered to `status === "showed"`.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add 'Visitas agendadas vs realizadas' chart

Grouped horizontal bar chart comparing scheduled vs realized appointments
per advisor with a fulfillment-rate label. Click drills into the
appointment drawer filtered to the matching slice."
```

---

## Task 4: Final cross-section sanity check

**Files:** none (verification only)

- [ ] **Step 1: Confirm section position**

Reload <http://localhost:3000>, Sales tab. Confirm the section order is:
1. Pipeline / KPI rows (existing)
2. Rendimiento Individual (existing)
3. Salud del Pipeline (existing)
4. Actividad de Conversaciones (existing)
5. Citas (existing — "Citas por mes por asesor")
6. **Responsabilidad del Asesor** (new — three cards in this order: Campos vacíos / Llamadas / Visitas)
7. Análisis de Pérdidas (existing)

- [ ] **Step 2: Filter interaction**

Apply a date-range filter from the global filter bar. Confirm all three new charts re-compute and re-render correctly (no stale rows from previous data window).

- [ ] **Step 3: Verify drill-down drawers still work for older charts**

Click into an existing chart (e.g., "Win/Loss por Asesor") and confirm the drill-down drawer behaves identically. (Sanity check that the new code didn't break shared state.)

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds. (Note: per `next.config.mjs` TypeScript errors are ignored at build time — the `tsc --noEmit` checks done in tasks 1–3 are the authoritative type gate.)

- [ ] **Step 5: No commit needed** (verification only)

If a regression was found, return to the relevant task; otherwise this task is complete.
