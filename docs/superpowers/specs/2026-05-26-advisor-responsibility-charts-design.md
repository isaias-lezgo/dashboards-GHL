# Advisor Responsibility Charts — Sales Dashboard

Add three new charts to the Sales dashboard (`components/dashboard/sales-dashboard.tsx`) to surface advisor responsibility / data-hygiene metrics:

1. Campos vacíos por asesor (empty opportunity fields per advisor)
2. Llamadas x asesor (calls per advisor, by status)
3. Visitas agendadas vs realizadas por asesor (scheduled vs realized visits)

All three follow established dashboard patterns: `DashboardCard`, `ChartCardHeader`, `ChartContainer`, `NonZeroTooltipContent`, drill-down via `ChartDrillDrawer` / `AppointmentDrillDrawer`.

## Placement

New `SectionHeader` titled **"Responsabilidad del Asesor"**, inserted between the existing `"Citas"` section and `"Análisis de Pérdidas"` section in `sales-dashboard.tsx`. The three charts render top-to-bottom in this section:

1. Campos vacíos por asesor
2. Llamadas x asesor
3. Visitas agendadas vs realizadas

## Chart 1 — Campos vacíos por asesor

**Goal:** measure each advisor's data-capture responsibility — how many opportunity fields they leave empty on average per opportunity.

### What counts as "empty"

**Standard opportunity fields** tracked:
- `value` — empty if `value === 0` or nullish
- `source` — empty if nullish or `""`
- `notes` — empty if nullish or `""`
- `tags` — empty if missing or `tags.length === 0`
- `priority` — empty if nullish or `""`

(System-generated fields like `id`, `pipelineId`, `pipelineStageId`, `status`, `createdAt`, `updatedAt`, `closedAt`, `currency`, `userId`, `locationId`, `statusId`, `archived` are excluded — advisors don't fill them.)

**Custom fields:**
- Build the global universe: union of all keys appearing in any opportunity's `customFieldsResolved` across the filtered dataset.
- For each opportunity, count a key as empty if:
  - the opportunity has no `customFieldsResolved` at all, OR
  - the key is missing from that object, OR
  - the value at that key is `""` or whitespace-only.

### Metric

For each advisor (`opportunities.filter(o => o.assignedTo === advisor)`):
- `totalOpps` = count of opps for advisor
- `totalEmptyStandard` = sum across opps of empty standard fields
- `totalEmptyCustom` = sum across opps of empty custom-field keys
- `avgEmptyStandard` = `totalEmptyStandard / totalOpps`
- `avgEmptyCustom` = `totalEmptyCustom / totalOpps`
- `avgTotal` = `avgEmptyStandard + avgEmptyCustom`

Advisors with `totalOpps === 0` are excluded.

### Visualization

- Horizontal stacked bar, one row per advisor.
- Two stacked segments (X axis = `avgEmpty`):
  - `avgEmptyStandard` — color `STRUCTURAL_NAVY` (#335577)
  - `avgEmptyCustom` — color `BRAND_AMBER` (#F59B1B)
- `LabelList` on the trailing segment showing `avgTotal.toFixed(1)` (e.g., "3.2 vacíos/opp").
- Sort descending by `avgTotal` (worst responsibility at top).
- Card height: `Math.max(200, rows * 64)` per existing pattern.

### Tooltip

`NonZeroTooltipContent` with a custom `formatter` that shows the `avg*` value as `value.toFixed(1)`. The advisor's `totalOpps` and absolute totals are conveyed via an `InfoTooltip` next to the title.

### Card header

- Title: `"Campos vacíos por asesor"`
- `InfoTooltip` explaining: "Promedio de campos vacíos por oportunidad. Mide qué tan completamente cada asesor llena los datos de sus oportunidades. Considera campos estándar (valor, fuente, notas, tags, prioridad) y todos los custom fields presentes en el dataset."
- `TotalBadge` showing total opps across all advisors.

### Drill-down

Clicking a bar opens `ChartDrillDrawer` with the advisor's opportunities, **sorted by empty-field count descending** (worst first). Title: `${advisor} · Oportunidades con campos vacíos`. Use existing `openDrill` helper, but pre-sort the array before passing.

### Empty state

If no advisors with opportunities exist after filtering, render `ChartEmpty message="Sin oportunidades para mostrar"`.

## Chart 2 — Llamadas x asesor

**Goal:** count of calls per advisor, broken down by call status.

### Metric

For each advisor in `calls.map(c => c.assignedTo)`:
- `completed` = count of calls with `status === "completed"`
- `missed` = count of calls with `status === "missed"`
- `noAnswer` = count of calls with `status === "no-answer"`
- `total` = sum

Sorted descending by `total`.

### Visualization

- Horizontal stacked bar, one row per advisor.
- Stack order (left-to-right):
  - `completed` — color `#10b981` (green)
  - `missed` — color `#ef4444` (red)
  - `noAnswer` — color `#94a3b8` (gray)
- `LabelList` on the last segment showing `total`.
- Legend at bottom with the three statuses.
- Card height: `Math.max(200, rows * 64)`.

### Tooltip

`NonZeroTooltipContent` — default formatter (integer counts).

### Card header

- Title: `"Llamadas por asesor"`
- `TotalBadge` showing total call count.

### Drill-down

Clicking a stack segment opens `ChartDrillDrawer` via `openDrillContacts` (existing helper) with the contactIds of the matched calls. Title: `${advisor} · ${statusLabel}` (e.g., "Rep A · Completadas").

### Empty state

`calls` is empty in live GHL data (per CLAUDE.md — GHL doesn't expose a public calls endpoint). The card always renders — if `calls.length === 0` it shows `ChartEmpty message="Sin llamadas registradas"`. No conditional hiding of the card.

### Status labels (Spanish)

- `completed` → "Completadas"
- `missed` → "Perdidas"
- `no-answer` → "Sin respuesta"

## Chart 3 — Visitas agendadas vs realizadas por asesor

**Goal:** compare scheduled appointments vs actually realized (showed) appointments per advisor, highlighting fulfillment rate.

### Metric

For each advisor in `appointments.map(a => a.assignedTo)`:
- `agendadas` = total appointments for advisor (all statuses)
- `realizadas` = appointments where `status === "showed"`
- `rate` = `agendadas > 0 ? (realizadas / agendadas) * 100 : 0`

Advisors with `agendadas === 0` excluded. Sorted descending by `rate`.

### Visualization

- Horizontal **grouped** bar chart (not stacked — two distinct bars per advisor row).
- Recharts handles this naturally with two `<Bar>` elements without `stackId`.
- Bars:
  - `agendadas` — color `STRUCTURAL_NAVY` (#335577)
  - `realizadas` — color `BRAND_AMBER` (#F59B1B)
- `LabelList` on `realizadas` showing `${rate.toFixed(0)}%`.
- Card height: `Math.max(200, rows * 80)` — slightly taller per row since each row has two bars.

### Tooltip

`NonZeroTooltipContent` showing `agendadas` and `realizadas` counts. The rate is implicit from the label and bar comparison.

### Card header

- Title: `"Visitas agendadas vs realizadas"`
- `InfoTooltip`: "Compara visitas agendadas (todas las citas, sin importar estatus) contra realizadas (estatus = 'showed'). La etiqueta muestra la tasa de cumplimiento del asesor."
- `TotalBadge` showing total agendadas.

### Drill-down

Clicking either bar opens `AppointmentDrillDrawer` (existing pattern from "Citas por mes por asesor"):
- Click on `agendadas` → all appointments for that advisor. Title: `${advisor} · Visitas agendadas`.
- Click on `realizadas` → only `status === "showed"` for that advisor. Title: `${advisor} · Visitas realizadas`.

### Empty state

`ChartEmpty message="Sin visitas para mostrar"` when no advisors qualify.

## Implementation notes

- All `useMemo` computations live in `sales-dashboard.tsx`. No changes to API, types, mock data, or the dashboard route.
- `calls` and `appointments` are already passed as props.
- Reuse `chartPaletteColor`, color constants, `NonZeroTooltipContent`, `ChartHint`, `LabelList` patterns from neighboring charts.
- All three charts must include `ChartHint` at the bottom indicating click-to-drill behavior.
- No new components, no new files. Pure additions inside the existing dashboard component.

## Out of scope

- No filtering controls beyond the global dashboard filters already applied upstream.
- No time-series breakdown (per request — these are advisor-aggregate views).
- No changes to existing charts (the existing "Citas por mes por asesor" stays as-is).
- No backend changes.
