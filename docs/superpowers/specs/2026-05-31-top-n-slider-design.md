# Top-N Slider for URL/ID Charts — Design Spec

**Date:** 2026-05-31  
**Status:** Approved

---

## Overview

Replace the hard-coded "top 30" limit on URL/ID attribution charts with a per-chart slider that lets the user choose how many entries to show, from 1 up to all available entries.

---

## Affected Charts

All 4 charts that have the `GroupByToggle` (URL/ID selector):

| Chart | Current limit | Default topN |
|-------|--------------|--------------|
| Oportunidades por Etapa del Pipeline | 30 | 30 |
| Oportunidades Perdidas por Razón de Pérdida | 30 | 30 |
| Citas por pauta | none (all) | total count |
| Oportunidades ganadas por pauta | none (all) | total count |

---

## New Component: `TopNSlider`

```ts
function TopNSlider({ value, max, onChange }: {
  value: number
  max: number
  onChange: (n: number) => void
})
```

- Renders an HTML `<input type="range">` from 1 to `max`, styled to match the existing `GroupByToggle` compact look
- Label to the left of the slider: `"Top {value}"` when `value < max`, `"Todo"` when `value === max`
- Sits inside the card's `actions` prop, to the right of `GroupByToggle`
- Clicking the slider calls `e.stopPropagation()` to avoid bubbling

---

## State

Four new `useState<number>` variables inside `MarketingDashboard`:

```ts
const [stageTopN, setStageTopN] = useState(30)
const [lostTopN, setLostTopN]   = useState(30)
// apptTopN and wonTopN initialized after first render via the computed totals,
// defaulting to a large sentinel (e.g. Infinity treated as "all")
const [apptTopN, setApptTopN]   = useState(Infinity)
const [wonTopN, setWonTopN]     = useState(Infinity)
```

For `apptTopN` and `wonTopN`, `Infinity` means "show all". When the slider max is known, `value === max` triggers the `"Todo"` label. The range input receives `Math.min(value, max)` as its numeric value.

---

## Data Computation Changes

### Pattern (same for all 4 charts)

Each useMemo:
1. Computes the **full** ranked key list (no slice) → `allKeys`
2. Applies `allKeys.slice(0, topN)` to get the displayed `keys`
3. Returns the sliced `keys` AND `allKeys.length` (the slider max)
4. Adds `topN` as a dependency

### Specific changes

**`pautaByStageRows`/`pautaByStageKeys`** (pipeline stages chart):
- Add `stageTopN` as dependency
- Return `{ pautaByStageRows, pautaByStageKeys, pautaByStageKeyCount }` where `pautaByStageKeyCount = allKeys.length`

**`lostByReasonRows`/`lostByReasonKeys`** (lost reason chart):
- Add `lostTopN` as dependency
- Return `{ lostByReasonRows, lostByReasonKeys, lostByReasonKeyCount }` where `lostByReasonKeyCount = allKeys.length`

**`paidTrafficWithAppt`** (citas por pauta):
- Currently returns a flat array sorted by count. Add `apptTopN` as dependency and apply `slice(0, apptTopN)`. Also return `apptKeyCount = total entries before slicing`.

**`wonPaidTraffic`** (oportunidades ganadas):
- Same pattern: add `wonTopN`, return `wonKeyCount`.

---

## Card Header Changes

Each of the 4 card headers changes its `actions` prop from:

```tsx
actions={<GroupByToggle value={xGroupBy} onChange={setXGroupBy} />}
```

to:

```tsx
actions={
  <div className="flex items-center gap-2">
    <TopNSlider value={Math.min(xTopN, xKeyCount)} max={xKeyCount} onChange={setXTopN} />
    <GroupByToggle value={xGroupBy} onChange={setXGroupBy} />
  </div>
}
```

---

## Hint Text

Changes from hard-coded `"top 30"` to dynamic:

```ts
`Apilado por ${groupBy === "url" ? "URL de atribución" : "ID de anuncio"} · ${topN >= keyCount ? "todo" : `top ${topN}`} · haz clic en un segmento para ver las oportunidades`
```

---

## No new files

`TopNSlider` is defined inline in `marketing-dashboard.tsx` alongside `GroupByToggle`, which lives there too. No new files needed.
