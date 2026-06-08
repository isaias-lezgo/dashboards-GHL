# Inline AI-generated charts with drill-down — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Area:** AI Assistant chat (`components/dashboard/conversations-chat.tsx`, `lib/ai-tools.ts`)

## Goal

Let the AI assistant render visual charts **inline in the chat**, and make each
chart **drillable**: clicking a bar / slice / point opens a drawer listing the
real records behind that group, reusing the existing dashboard drill-down UI.

## Decisions (locked)

- **Drill data model:** the AI attaches the real `contactIds` to each chart
  group. Clicking a group shows exactly those contacts. Chart numbers and drawer
  contents always match because both come from the same deterministic tool call.
- **Chart types:** `bar`, `pie` (donut), `line`. (No horizontal bar for v1.)
- **When to chart:** proactively — when an answer compares groups or shows a
  trend, the AI renders a chart on its own plus a short text summary. Not limited
  to explicit requests.
- **Inline, not panel:** the chart renders in the message stream, not the left
  context panel.

## Existing infrastructure reused (no new versions of these)

- `NonZeroTooltipContent` (`components/dashboard/dashboard-ui.tsx`) — required
  tooltip per project chart rules.
- `ChartContainer`, `ChartTooltip` (`components/ui/chart.tsx`) — Recharts wrapper.
- `ChartDrillDrawer` (`components/dashboard/chart-drill-drawer.tsx`) — already
  accepts a `contactItems: Contact[]` prop, renders a clickable contact list, and
  forwards selection to `DetailDrawer`.
- `DetailDrawer` (`components/dashboard/detail-drawer.tsx`) — full contact /
  opportunity detail view.
- `show_in_panel` (`lib/ai-tools.ts`) — the proven "UI-only tool" pattern this
  feature mirrors.

## Architecture

### 1. New tool: `render_chart`

Added to `TOOL_DEFINITIONS` in `lib/ai-tools.ts`. UI-only directive, same shape
of contract as `show_in_panel` (returns an acknowledgement, does no data work).

Input schema:

```jsonc
{
  "type": "bar" | "line" | "pie",
  "title": "string",            // Spanish heading shown above the chart
  "valueLabel": "string",       // optional; axis/tooltip label, e.g. "Leads", "Valor (MXN)"
  "series": [
    {
      "label": "string",        // group name, e.g. "Meta"
      "value": "number",        // the real number from aggregate/relate
      "contactIds": ["string"]  // optional; records behind this group → drill-down
    }
  ]
}
```

Executor (`executeTool` switch): no-op acknowledgement:

```ts
case "render_chart": {
  const series = Array.isArray(input.series) ? input.series : [];
  return { ok: true, points: series.length };
}
```

The chart spec lives inside the persisted `tool_use` block, so it is part of the
conversation history — it survives tab switches and re-renders with no extra
state.

### 2. System prompt addition (`lib/ai-context.ts` → `CONVERSATIONS_SYSTEM_PROMPT`)

Instruct the model to:

1. Render a chart proactively when the answer compares groups or shows a trend.
2. **Only ever pass numbers obtained from `aggregate` / `relate`.** Never invent
   or eyeball values for a chart.
3. Include `contactIds` per group when the underlying records are contacts, so the
   chart is drillable. Prefer `relate` with `includeContactIds: true` (or a
   `search_*` call) when a drillable chart is wanted.
4. Still provide a one-line text summary alongside the chart.
5. Call `render_chart` as the final step of the turn (after gathering data).

### 3. Inline rendering — new component `components/dashboard/chat-chart.tsx`

Renders one chart spec with the existing stack:

- `ChartContainer` + `ChartTooltip` + `NonZeroTooltipContent`.
- Recharts `BarChart` / `LineChart` / `PieChart` selected by `spec.type`.
- Color palette consistent with existing dashboard charts.
- Props: `{ spec: ChartSpec; onDrill?: (title: string, contactIds: string[]) => void }`.
- A bar/slice/point is clickable only when its group has a non-empty
  `contactIds`; otherwise it renders non-interactive.

A shared `ChartSpec` type is exported from `lib/ai-tools.ts` (next to
`ChatDataset`) so both the executor and the component agree on the shape.

### 4. Wiring in `ConvMessageBubble` (`conversations-chat.tsx`)

When a `tool_use` block has `name === "render_chart"`, render `<ChatChart>`
inline **instead of** the wrench chip. All other tools keep their existing chip
summary. `ConvMessageBubble` receives an `onDrill` callback (threaded from
`ConversationsChat`) to pass into `ChatChart`.

### 5. Drill-down drawer (owned by `ConversationsChat`)

`ConversationsChat` owns a single drawer state:

```ts
const [chartDrill, setChartDrill] = useState<DrillState>(DRILL_CLOSED);
```

`onDrill(title, contactIds)` resolves `contactIds → Contact[]` from
`dataset.contacts` and opens `ChartDrillDrawer` with those as `contactItems`.
`ConversationsChat` already holds the full dataset, so it can supply every prop
`ChartDrillDrawer` / `DetailDrawer` need: `contacts`, `opportunities`, `tasks`,
`calls`, `appointments`, `messages`, `pautas`, `locationId`.

`ChartDrillDrawer` renders the contact list → clicking a contact opens
`DetailDrawer`. No new drawer code.

## Data flow

```
user asks
  → AI calls aggregate / relate  (real numbers [+ contactIds via includeContactIds])
  → AI calls render_chart { type, title, series:[{label, value, contactIds}] }
tool_use block persisted in message
  → ConvMessageBubble sees name === "render_chart"
  → renders <ChatChart spec=... onDrill=... /> inline
click bar/slice
  → onDrill(title, contactIds)
  → ConversationsChat resolves Contact[] and opens ChartDrillDrawer (contactItems)
  → click contact → DetailDrawer
```

## Files touched

| File | Change |
| --- | --- |
| `lib/ai-tools.ts` | Add `render_chart` to `TOOL_DEFINITIONS`; add `render_chart` case to `executeTool`; export `ChartSpec` / `ChartSeriesPoint` types. |
| `lib/ai-context.ts` | Extend `CONVERSATIONS_SYSTEM_PROMPT` with charting guidance. |
| `components/dashboard/chat-chart.tsx` | **New.** Renders a `ChartSpec` (bar/line/pie) with drill callbacks. |
| `components/dashboard/conversations-chat.tsx` | Render `<ChatChart>` for `render_chart` tool_use blocks; own `ChartDrillDrawer` state; thread `onDrill`. |

`hooks/use-agent-loop.ts` needs **no change**: `render_chart` falls through to the
default `executeTool(...)` branch, like `show_in_panel`.

## Trade-offs / non-goals

- **Accuracy guaranteed** by sourcing numbers from deterministic tools, not the
  model.
- `aggregate` does not return `contactIds`; `relate` does (`includeContactIds`).
  Aggregate-only charts will be non-drillable unless the model also runs a
  `search_*`. The system prompt nudges toward `relate` for drillable charts.
- v1 supports a single value series per chart (no grouped/stacked multi-series).
  Sufficient for the common "count/sum by group" and "trend over time" cases.
- No persistence of charts beyond the in-memory conversation (consistent with the
  rest of the chat). Markdown/JSON export of charts is out of scope for v1.

## Testing

No automated test framework in this repo (per CLAUDE.md). Verification is manual:

1. `npm run dev`, open Asistente IA.
2. Ask "¿cuántos leads por fuente?" → expect a bar chart + summary; numbers match
   an `aggregate` sanity check.
3. Click a bar → drawer lists that group's contacts → click one → `DetailDrawer`
   opens.
4. Ask for a trend ("leads creados por semana") → expect a line chart.
5. Ask for a share question ("distribución de oportunidades por etapa") → pie.
6. Switch to Marketing tab and back → chart still present (history preserved).
7. `npx tsc --noEmit` passes.
