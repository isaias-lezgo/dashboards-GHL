# Top-N Slider for URL/ID Charts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-chart slider next to each URL/ID toggle that lets the user control how many attribution entries are shown, replacing the hard-coded top-30 cap.

**Architecture:** All changes are confined to `components/dashboard/marketing-dashboard.tsx`. A new `TopNSlider` component renders a label + range input inline in card headers. Four new state variables (one per chart) drive how many keys each useMemo returns. Each useMemo is updated to compute the full key list first, then slice by topN, and also return the total count for the slider max.

**Tech Stack:** React (useState, useMemo), HTML range input with `accent-primary` for styling, Tailwind CSS.

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `components/dashboard/marketing-dashboard.tsx` | New component, 4 state vars, 4 useMemo updates, 4 card header actions, 2 hint strings |

---

### Task 1: Add `TopNSlider` component and 4 state variables

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx`

- [ ] **Step 1: Add `TopNSlider` after `GroupByToggle` (around line 277)**

Insert this function definition immediately after the closing `}` of `GroupByToggle`:

```tsx
function TopNSlider({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const effectiveValue = Math.min(value, max)
  const isAll = effectiveValue >= max
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] font-medium text-muted-foreground tabular-nums w-12 text-right shrink-0">
        {isAll ? "Todo" : `Top ${effectiveValue}`}
      </span>
      <input
        type="range"
        min={1}
        max={max || 1}
        value={effectiveValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-20 cursor-pointer accent-primary"
      />
    </div>
  )
}
```

- [ ] **Step 2: Add 4 state variables inside `MarketingDashboard`**

After the existing `const [lostGroupBy, setLostGroupBy] = useState<PaidGroupBy>("url")` line (around line 285), add:

```ts
const [stageTopN, setStageTopN] = useState(30)
const [lostTopN, setLostTopN] = useState(30)
const [apptTopN, setApptTopN] = useState(Infinity)
const [wonTopN, setWonTopN] = useState(Infinity)
```

- [ ] **Step 3: Build to verify no syntax errors**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds (no new errors).

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat: add TopNSlider component and topN state for URL/ID charts"
```

---

### Task 2: Update pipeline-stages useMemo + card header + hint

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx`

- [ ] **Step 1: Update `pautaByStageRows`/`pautaByStageKeys` useMemo**

Replace the current useMemo (lines ~477–507) with:

```ts
const { pautaByStageRows, pautaByStageKeys, pautaByStageKeyCount } = useMemo(() => {
  const totals = new Map<string, number>()
  const perStage = new Map<string, Map<string, number>>()
  for (const stage of stageOrder) perStage.set(stage, new Map())

  for (const opp of opportunities) {
    if (opp.status === "lost") continue
    const rawKey = stageGroupBy === "url" ? opp.attributionUrl : opp.adId
    if (!rawKey) continue
    const stageMap = perStage.get(opp.stage)
    if (!stageMap) continue
    stageMap.set(rawKey, (stageMap.get(rawKey) ?? 0) + 1)
    totals.set(rawKey, (totals.get(rawKey) ?? 0) + 1)
  }

  const allKeys = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
  const pautaByStageKeyCount = allKeys.length
  const keys = stageTopN >= pautaByStageKeyCount ? allKeys : allKeys.slice(0, Math.round(stageTopN))

  const rows = stageOrder
    .map((stage) => {
      const row: Record<string, string | number> = { stage }
      const stageMap = perStage.get(stage)!
      for (const k of keys) row[k] = stageMap.get(k) ?? 0
      return row
    })
    .filter((row) => keys.some((k) => (row[k] as number) > 0))

  return { pautaByStageRows: rows, pautaByStageKeys: keys, pautaByStageKeyCount }
}, [opportunities, stageOrder, stageGroupBy, stageTopN])
```

- [ ] **Step 2: Update the pipeline-stages card header actions**

Find (around line 1036):
```tsx
actions={<GroupByToggle value={stageGroupBy} onChange={setStageGroupBy} />}
```

Replace with:
```tsx
actions={
  <div className="flex items-center gap-2">
    <TopNSlider value={stageTopN} max={pautaByStageKeyCount} onChange={setStageTopN} />
    <GroupByToggle value={stageGroupBy} onChange={setStageGroupBy} />
  </div>
}
```

- [ ] **Step 3: Update the pipeline-stages hint text**

Find (around line 1102):
```tsx
{`Apilado por ${stageGroupBy === "url" ? "URL de atribución" : "ID de anuncio"} · top 30 · haz clic en un segmento para ver las oportunidades`}
```

Replace with:
```tsx
{`Apilado por ${stageGroupBy === "url" ? "URL de atribución" : "ID de anuncio"} · ${stageTopN >= pautaByStageKeyCount ? "todo" : `top ${stageTopN}`} · haz clic en un segmento para ver las oportunidades`}
```

- [ ] **Step 4: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat: add TopN slider to pipeline stages chart"
```

---

### Task 3: Update lost-reasons useMemo + card header + hint

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx`

- [ ] **Step 1: Update `lostByReasonRows`/`lostByReasonKeys` useMemo**

Replace the current useMemo (lines ~521–553) with:

```ts
const { lostByReasonRows, lostByReasonKeys, lostByReasonKeyCount } = useMemo(() => {
  const totals = new Map<string, number>()
  const perReason = new Map<string, Map<string, number>>()

  for (const opp of opportunities) {
    if (opp.status !== "lost") continue
    const rawKey = lostGroupBy === "url" ? opp.attributionUrl : opp.adId
    if (!rawKey) continue
    const reason = opp.lostReason || "Sin razón"
    if (!perReason.has(reason)) perReason.set(reason, new Map())
    const reasonMap = perReason.get(reason)!
    reasonMap.set(rawKey, (reasonMap.get(rawKey) ?? 0) + 1)
    totals.set(rawKey, (totals.get(rawKey) ?? 0) + 1)
  }

  const allKeys = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
  const lostByReasonKeyCount = allKeys.length
  const keys = lostTopN >= lostByReasonKeyCount ? allKeys : allKeys.slice(0, Math.round(lostTopN))

  const reasons = Array.from(perReason.keys()).sort()

  const rows = reasons
    .map((reason) => {
      const row: Record<string, string | number> = { reason }
      const reasonMap = perReason.get(reason)!
      for (const k of keys) row[k] = reasonMap.get(k) ?? 0
      return row
    })
    .filter((row) => keys.some((k) => (row[k] as number) > 0))

  return { lostByReasonRows: rows, lostByReasonKeys: keys, lostByReasonKeyCount }
}, [opportunities, lostGroupBy, lostTopN])
```

- [ ] **Step 2: Update the lost-reasons card header actions**

Find (around line 1114):
```tsx
actions={<GroupByToggle value={lostGroupBy} onChange={setLostGroupBy} />}
```

Replace with:
```tsx
actions={
  <div className="flex items-center gap-2">
    <TopNSlider value={lostTopN} max={lostByReasonKeyCount} onChange={setLostTopN} />
    <GroupByToggle value={lostGroupBy} onChange={setLostGroupBy} />
  </div>
}
```

- [ ] **Step 3: Update the lost-reasons hint text**

Find (around line 1178):
```tsx
{`Apilado por ${lostGroupBy === "url" ? "URL de atribución" : "ID de anuncio"} · top 30 · haz clic en un segmento para ver las oportunidades`}
```

Replace with:
```tsx
{`Apilado por ${lostGroupBy === "url" ? "URL de atribución" : "ID de anuncio"} · ${lostTopN >= lostByReasonKeyCount ? "todo" : `top ${lostTopN}`} · haz clic en un segmento para ver las oportunidades`}
```

- [ ] **Step 4: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat: add TopN slider to lost reasons chart"
```

---

### Task 4: Update citas-por-pauta useMemo + card header

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx`

- [ ] **Step 1: Update `paidTrafficWithAppt` useMemo**

Replace the current useMemo (lines ~699–716) with:

```ts
const { paidTrafficWithAppt, apptKeyCount } = useMemo(() => {
  const apptContactIds = new Set(appointments.map((a) => a.contactId))
  const counts = new Map<string, number>()
  for (const o of opportunities) {
    if (!isPaidTraffic(o)) continue
    if (!apptContactIds.has(o.contactId)) continue
    const rawKey = apptGroupBy === "url" ? o.attributionUrl : o.adId
    if (!rawKey) continue
    counts.set(rawKey, (counts.get(rawKey) ?? 0) + 1)
  }
  const allEntries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  const apptKeyCount = allEntries.length
  const sliced = apptTopN >= apptKeyCount ? allEntries : allEntries.slice(0, Math.round(apptTopN))
  return {
    paidTrafficWithAppt: sliced.map(([rawKey, count]) => ({
      rawKey,
      label: apptGroupBy === "url" ? paidTrafficUrlLabel(rawKey) : rawKey,
      count,
    })),
    apptKeyCount,
  }
}, [opportunities, appointments, apptGroupBy, apptTopN])
```

- [ ] **Step 2: Update the citas-por-pauta card header actions**

Find (around line 1352):
```tsx
actions={<GroupByToggle value={apptGroupBy} onChange={setApptGroupBy} />}
```

Replace with:
```tsx
actions={
  <div className="flex items-center gap-2">
    <TopNSlider value={apptTopN} max={apptKeyCount} onChange={setApptTopN} />
    <GroupByToggle value={apptGroupBy} onChange={setApptGroupBy} />
  </div>
}
```

- [ ] **Step 3: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat: add TopN slider to citas por pauta chart"
```

---

### Task 5: Update oportunidades-ganadas useMemo + card header + browser verify

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx`

- [ ] **Step 1: Update `wonPaidTraffic` useMemo**

Replace the current useMemo (lines ~719–736) with:

```ts
const { wonPaidTraffic, wonKeyCount } = useMemo(() => {
  const counts = new Map<string, { count: number; value: number }>()
  for (const o of opportunities) {
    if (!isPaidTraffic(o) || o.status !== "won") continue
    const rawKey = wonGroupBy === "url" ? o.attributionUrl : o.adId
    if (!rawKey) continue
    const prev = counts.get(rawKey) ?? { count: 0, value: 0 }
    counts.set(rawKey, { count: prev.count + 1, value: prev.value + o.value })
  }
  const allEntries = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count)
  const wonKeyCount = allEntries.length
  const sliced = wonTopN >= wonKeyCount ? allEntries : allEntries.slice(0, Math.round(wonTopN))
  return {
    wonPaidTraffic: sliced.map(([rawKey, { count, value }]) => ({
      rawKey,
      label: wonGroupBy === "url" ? paidTrafficUrlLabel(rawKey) : rawKey,
      count,
      value,
    })),
    wonKeyCount,
  }
}, [opportunities, wonGroupBy, wonTopN])
```

- [ ] **Step 2: Update the oportunidades-ganadas card header actions**

Find (around line 1425):
```tsx
actions={<GroupByToggle value={wonGroupBy} onChange={setWonGroupBy} />}
```

Replace with:
```tsx
actions={
  <div className="flex items-center gap-2">
    <TopNSlider value={wonTopN} max={wonKeyCount} onChange={setWonTopN} />
    <GroupByToggle value={wonGroupBy} onChange={setWonGroupBy} />
  </div>
}
```

- [ ] **Step 3: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Start dev server and verify in browser**

```bash
npm run dev
```

Navigate to `http://localhost:3000`, go to Marketing tab. Verify for each of the 4 charts:
- A compact slider appears to the left of the URL/ID toggle in the card header
- "Oportunidades por Etapa del Pipeline": slider starts at "Top 30", dragging right shows more bars up to "Todo"
- "Oportunidades Perdidas por Razón de Pérdida": same behavior
- "Citas por pauta": slider starts at "Todo" (far right), dragging left reduces bars
- "Oportunidades ganadas por pauta": slider starts at "Todo", dragging left reduces bars
- Hint text on the first two charts updates dynamically to reflect the current topN

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat: add TopN slider to oportunidades ganadas chart"
```
