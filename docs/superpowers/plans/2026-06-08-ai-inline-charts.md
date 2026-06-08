# Inline AI-generated Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI assistant render bar/line/pie charts inline in the chat, with each group drillable into a contact-list drawer.

**Architecture:** A new UI-only `render_chart` tool (mirrors `show_in_panel`) carries the chart spec — including the real `contactIds` per group — inside the persisted `tool_use` block. `ConvMessageBubble` renders that block as a `<ChatChart>` instead of a tool chip. Clicking a group calls an `onDrill` callback that opens the existing `ChartDrillDrawer` (reused via its `contactItems` prop) → `DetailDrawer`.

**Tech Stack:** Next.js 15, React, TypeScript, Recharts (via `components/ui/chart.tsx` wrapper), Tailwind. Verification is `npx tsc --noEmit` + manual browser checks (no automated test framework in this repo).

**Spec:** `docs/superpowers/specs/2026-06-08-ai-inline-charts-design.md`

---

## File structure

| File | Responsibility |
| --- | --- |
| `lib/ai-tools.ts` (modify) | `ChartSpec`/`ChartSeriesPoint` types, `parseChartSpec` validator, `render_chart` tool definition, executor no-op case. |
| `components/dashboard/chat-chart.tsx` (create) | Render one `ChartSpec` (bar/line/pie) with drill callbacks, using the existing chart wrapper + `NonZeroTooltipContent`. |
| `components/dashboard/conversations-chat.tsx` (modify) | Render `<ChatChart>` for `render_chart` blocks; own one `ChartDrillDrawer` state; thread `onDrill`. |
| `lib/ai-context.ts` (modify) | Extend `CONVERSATIONS_SYSTEM_PROMPT` with charting guidance. |

`hooks/use-agent-loop.ts` needs **no change** — `render_chart` falls through to the default `executeTool(...)` branch like `show_in_panel`.

---

## Task 1: Chart types, validator, tool definition, executor

**Files:**
- Modify: `lib/ai-tools.ts`

- [ ] **Step 1: Add the shared chart types** near the top of `lib/ai-tools.ts`, immediately after the `ChatDataset` interface (around line 24).

```ts
export interface ChartSeriesPoint {
  label: string;
  value: number;
  /** Records behind this group, for the drill-down drawer. Omit for non-drillable groups (e.g. pure time trends). */
  contactIds?: string[];
}

export interface ChartSpec {
  type: "bar" | "line" | "pie";
  title: string;
  /** Axis/tooltip label, e.g. "Leads" or "Valor (MXN)". */
  valueLabel?: string;
  series: ChartSeriesPoint[];
}

/**
 * Hard cap on contactIds kept per chart group for the drill-down, to bound
 * token cost. The system prompt also instructs the model to send at most this
 * many; this slice is the safety net if it sends more.
 */
export const MAX_CHART_CONTACT_IDS = 50;

/**
 * Safely turn an unknown render_chart tool input into a ChartSpec.
 * Returns null when the shape is unusable so the UI can skip rendering.
 * Truncates each group's contactIds to MAX_CHART_CONTACT_IDS.
 */
export function parseChartSpec(input: unknown): ChartSpec | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const type = o.type;
  if (type !== "bar" && type !== "line" && type !== "pie") return null;
  if (!Array.isArray(o.series)) return null;

  const series: ChartSeriesPoint[] = [];
  for (const raw of o.series) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label : "";
    const value =
      typeof r.value === "number" && Number.isFinite(r.value)
        ? r.value
        : Number(r.value);
    if (!label || !Number.isFinite(value)) continue;
    const contactIds = Array.isArray(r.contactIds)
      ? r.contactIds.map((x) => String(x)).slice(0, MAX_CHART_CONTACT_IDS)
      : undefined;
    series.push({ label, value, contactIds });
  }
  if (series.length === 0) return null;

  return {
    type,
    title: typeof o.title === "string" ? o.title : "",
    valueLabel: typeof o.valueLabel === "string" ? o.valueLabel : undefined,
    series,
  };
}
```

- [ ] **Step 2: Add the `render_chart` tool definition** to the `TOOL_DEFINITIONS` array in `lib/ai-tools.ts`. Insert it as the final element, immediately AFTER the `show_in_panel` object (around line 421) and BEFORE the closing `] as const;`.

```ts
  {
    name: "render_chart",
    description:
      "Renders a visual chart inline in the chat. Use it ONLY when the user asks for a chart, or when it genuinely adds value — a comparison across several groups or a trend over time. Do NOT chart single numbers, short lists, or one-contact profiles. Call it as your FINAL step. CRITICAL: every `value` MUST come from a prior `aggregate` or `relate` call — NEVER invent or eyeball numbers. To make the chart drillable, include `contactIds` on each group with the contacts behind that bar/slice (get them from `relate({ ..., includeContactIds: true })` or a `search_*` call); include AT MOST 50 per group (the system truncates to 50 and tells the user the drill-down is limited). Groups without contactIds render but are not clickable. Always also give a one-line text summary alongside the chart.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["bar", "line", "pie"],
          description:
            "bar = counts/sums by group; line = a trend over ordered time buckets; pie = share of a total.",
        },
        title: {
          type: "string",
          description: "Short heading in Spanish shown above the chart (e.g. 'Leads por fuente').",
        },
        valueLabel: {
          type: "string",
          description: "What the numbers represent, e.g. 'Leads', 'Oportunidades', 'Valor (MXN)'. Shown in the tooltip.",
        },
        series: {
          type: "array",
          description: "The data points. One entry per bar/slice/point.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Group name (e.g. 'Meta', 'Semana 22', 'Primera Cita')." },
              value: { type: "number", description: "The real number from aggregate/relate for this group." },
              contactIds: {
                type: "array",
                items: { type: "string" },
                description: "The contacts behind this group, for drill-down. Omit when not contact-backed.",
              },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["type", "title", "series"],
    },
  },
```

- [ ] **Step 3: Add the executor case** in the `executeTool` switch in `lib/ai-tools.ts`, immediately after the `show_in_panel` case (around line 674) and before `default:`.

```ts
    case "render_chart": {
      // UI-only directive. The chart is rendered client-side from the tool_use
      // block in conversations-chat.tsx. Here we just acknowledge.
      const series = Array.isArray((input as Record<string, unknown>).series)
        ? ((input as Record<string, unknown>).series as unknown[])
        : [];
      return { ok: true, points: series.length };
    }
```

- [ ] **Step 4: Typecheck.**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output (clean pass).

- [ ] **Step 5: Commit.**

```bash
git add lib/ai-tools.ts
git commit -m "feat(ai): add render_chart tool, ChartSpec types and validator"
```

---

## Task 2: `ChatChart` component

**Files:**
- Create: `components/dashboard/chat-chart.tsx`

- [ ] **Step 1: Create `components/dashboard/chat-chart.tsx`** with this full content.

```tsx
"use client";

import {
  Bar,
  BarChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  NonZeroTooltipContent,
  chartPaletteColor,
  BRAND_AMBER,
} from "./dashboard-ui";
import { MAX_CHART_CONTACT_IDS, type ChartSpec } from "@/lib/ai-tools";

interface ChatChartProps {
  spec: ChartSpec;
  onDrill?: (title: string, contactIds: string[]) => void;
}

interface ChartDatum {
  label: string;
  value: number;
  contactIds: string[];
  fill: string;
}

export function ChatChart({ spec, onDrill }: ChatChartProps) {
  const data: ChartDatum[] = spec.series.map((s, i) => ({
    label: s.label,
    value: s.value,
    contactIds: s.contactIds ?? [],
    fill: chartPaletteColor(i),
  }));

  const config: ChartConfig = {
    value: { label: spec.valueLabel ?? "Total", color: BRAND_AMBER },
  };

  const clickable = data.some((d) => d.contactIds.length > 0);

  const drill = (datum?: { contactIds?: string[] }) => {
    const ids = datum?.contactIds ?? [];
    if (ids.length > 0) onDrill?.(spec.title, ids);
  };

  // Bar & line expose the clicked point via the chart-level onClick state.
  const onChartClick = (state: { activePayload?: Array<{ payload?: ChartDatum }> }) => {
    drill(state?.activePayload?.[0]?.payload);
  };

  return (
    <div className="w-full max-w-[520px] rounded-xl border border-border/50 bg-card/40 p-3">
      {spec.title && (
        <p className="mb-2 px-1 text-xs font-semibold text-foreground/80">
          {spec.title}
        </p>
      )}
      <ChartContainer config={config} className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === "pie" ? (
            <PieChart>
              <ChartTooltip content={<NonZeroTooltipContent nameKey="label" />} />
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={1}
                onClick={(d: { payload?: ChartDatum }) => drill(d?.payload ?? (d as ChartDatum))}
                className={clickable ? "cursor-pointer" : undefined}
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Pie>
            </PieChart>
          ) : spec.type === "line" ? (
            <LineChart
              data={data}
              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
              onClick={onChartClick}
              className={clickable ? "cursor-pointer" : undefined}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <ChartTooltip content={<NonZeroTooltipContent />} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={BRAND_AMBER}
                strokeWidth={2}
                dot={{ r: 3, fill: BRAND_AMBER }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          ) : (
            <BarChart
              data={data}
              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
              onClick={onChartClick}
              className={clickable ? "cursor-pointer" : undefined}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <ChartTooltip content={<NonZeroTooltipContent />} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </ChartContainer>
      {clickable && (
        <p className="mt-1 px-1 text-[10px] text-muted-foreground/60">
          Haz clic en una barra o sección para ver los contactos (hasta{" "}
          {MAX_CHART_CONTACT_IDS} por grupo).
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output (clean pass).

> Note: `ChartContainer` requires a single React element child; `ResponsiveContainer` provides that. If tsc complains that `onClick` state typing on `BarChart`/`LineChart` is too strict, widen the `onChartClick` param to `(state: any)` — Recharts' `CategoricalChartState` is not exported. This is the one acceptable `any` in the component.

- [ ] **Step 3: Commit.**

```bash
git add components/dashboard/chat-chart.tsx
git commit -m "feat(ai): add ChatChart component for inline bar/line/pie charts"
```

---

## Task 3: Render charts inline + drill-down drawer in the chat

**Files:**
- Modify: `components/dashboard/conversations-chat.tsx`

- [ ] **Step 1: Add imports** at the top of `conversations-chat.tsx`, after the existing `ConversationsContextPanel` import (line 43).

```tsx
import { ChatChart } from "@/components/dashboard/chat-chart";
import {
  ChartDrillDrawer,
  DRILL_CLOSED,
  type DrillState,
} from "@/components/dashboard/chart-drill-drawer";
import { parseChartSpec } from "@/lib/ai-tools";
```

- [ ] **Step 2: Add drawer state + drill handler** inside the `ConversationsChat` component, immediately after the existing `prevSummaryRef` declaration (line 98).

```tsx
  const [chartDrill, setChartDrill] = useState<DrillState>(DRILL_CLOSED);

  const handleChartDrill = useCallback(
    (title: string, contactIds: string[]) => {
      const items = contactIds
        .map((id) => contactById.get(id))
        .filter((c): c is Contact => Boolean(c));
      setChartDrill({ open: true, title, opportunities: [], contactItems: items });
    },
    [contactById],
  );
```

> `contactById` already exists (line 102) and `Contact` is already imported (line 21).

- [ ] **Step 3: Pass `onDrill` into the message list.** Find the messages map (line 356):

```tsx
          {messages.map((m, i) => (
            <ConvMessageBubble key={i} message={m} />
          ))}
```

Replace it with:

```tsx
          {messages.map((m, i) => (
            <ConvMessageBubble key={i} message={m} onDrill={handleChartDrill} />
          ))}
```

- [ ] **Step 4: Render the drawer.** In the component's returned JSX, find the closing of the outer container — the last two lines before the final `);` (the `</div>` that closes `flex min-h-0 flex-1 flex-col` and the `</div>` that closes the root `flex h-[calc...]`). Add the drawer right before the root closing `</div>`. Concretely, locate:

```tsx
        </div>
      </div>
    </div>
  );
}
```

(the first `</div>` closes the input bar wrapper, the second closes the chat column, the third closes the root). Replace with:

```tsx
        </div>
      </div>

      <ChartDrillDrawer
        drill={chartDrill}
        onDrillChange={setChartDrill}
        contacts={dataset.contacts}
        tasks={dataset.tasks}
        calls={dataset.calls}
        allOpportunities={dataset.opportunities}
        allPautas={dataset.pautas}
        appointments={dataset.appointments}
        messages={dataset.messages}
        locationId={locationId ?? ""}
      />
    </div>
  );
}
```

> The root element is `<div className="flex h-[calc(100dvh-112px)] flex-col ... md:flex-row">`. The drawer is a portal-based `Sheet`, so placing it as the last child of the root is layout-safe.

- [ ] **Step 5: Update `ConvMessageBubble` signature** (line 473) to accept `onDrill`:

```tsx
function ConvMessageBubble({
  message,
  onDrill,
}: {
  message: UIMessage;
  onDrill?: (title: string, contactIds: string[]) => void;
}) {
```

- [ ] **Step 6: Split chart tool-use blocks from other tool chips.** In `ConvMessageBubble`, find the `toolUseBlocks` declaration (line 477):

```tsx
  const toolUseBlocks = message.blocks.filter(
    (b): b is ToolUseBlock => b.type === "tool_use"
  );
```

Add directly below it:

```tsx
  const chartBlocks = toolUseBlocks.filter((b) => b.name === "render_chart");
  const otherToolBlocks = toolUseBlocks.filter((b) => b.name !== "render_chart");
```

- [ ] **Step 7: Render the charts and use `otherToolBlocks` for chips.** Find the tool-chip block (line 539):

```tsx
      {toolUseBlocks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(
            toolUseBlocks.reduce<Record<string, number>>((acc, b) => {
```

Change `toolUseBlocks.length > 0` to `otherToolBlocks.length > 0`, and change the `toolUseBlocks.reduce` to `otherToolBlocks.reduce`. Then, immediately BEFORE that `{otherToolBlocks.length > 0 && (` line, insert the chart rendering:

```tsx
      {chartBlocks.map((b, i) => {
        const spec = parseChartSpec(b.input);
        if (!spec) return null;
        return (
          <div key={`chart-${i}`} className="w-full">
            <ChatChart spec={spec} onDrill={onDrill} />
          </div>
        );
      })}
```

> Result: a chart-bearing assistant message shows its text bubble, then the chart(s), then any non-chart tool chips.

- [ ] **Step 8: Typecheck.**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output (clean pass).

- [ ] **Step 9: Commit.**

```bash
git add components/dashboard/conversations-chat.tsx
git commit -m "feat(ai): render render_chart blocks inline with drill-down drawer"
```

---

## Task 4: System prompt charting guidance

**Files:**
- Modify: `lib/ai-context.ts`

- [ ] **Step 1: Add a charting section** to `CONVERSATIONS_SYSTEM_PROMPT`. Find the `# El panel de contexto (IMPORTANTE)` heading (around line 205) and insert this new section immediately BEFORE it:

```
# Gráficas visuales (render_chart)

Dibuja una gráfica con \`render_chart\` (como paso FINAL, además de un resumen breve en texto) SOLO cuando el usuario la pida explícitamente, o cuando aporte un valor claro a la respuesta: una comparación entre varios grupos o una tendencia en el tiempo. NO grafiques respuestas de un solo número, listas cortas, perfiles de un contacto, ni cuando una tabla o frase ya comunica mejor el dato. Ante la duda, responde en texto.

- **Números reales únicamente**: cada \`value\` debe venir de un \`aggregate\` o \`relate\` previo. NUNCA inventes ni estimes los números de una gráfica.
- **Hazla interactiva, pero acotada**: incluye \`contactIds\` en cada grupo con los contactos detrás de esa barra/sección, para que el usuario pueda hacer clic y verlos. Incluye COMO MÁXIMO 50 contactIds por grupo (el sistema recorta a 50 y avisa al usuario que el detalle está limitado). Obtén esos IDs con \`relate({ ..., includeContactIds: true })\` o con \`search_*\`. Si un grupo no está respaldado por contactos (p.ej. una tendencia temporal), omite \`contactIds\` en ese grupo.
- **Tipo correcto**: \`bar\` para comparar grupos, \`line\` para tendencias en buckets de tiempo ordenados, \`pie\` para participación sobre un total.
- **Título corto en español** (p.ej. "Leads por fuente") y \`valueLabel\` describiendo la métrica ("Leads", "Valor (MXN)").
- No reemplaces el resumen en texto: la gráfica acompaña, no sustituye, tu conclusión escrita.
```

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output (clean pass).

- [ ] **Step 3: Commit.**

```bash
git add lib/ai-context.ts
git commit -m "feat(ai): prompt the assistant to render charts proactively from real data"
```

---

## Task 5: Manual verification

**Files:** none (manual QA).

- [ ] **Step 1: Start the dev server.**

Run: `npm run dev`
Open `http://localhost:3000`, go to the **Asistente IA** tab.

- [ ] **Step 2: Bar + drill-down.** Ask: `¿cuántos leads por fuente?`
Expected: a short text summary plus a bar chart titled in Spanish. Hover shows the `NonZeroTooltipContent` tooltip (zero groups hidden). Click a bar → `ChartDrillDrawer` opens listing that group's contacts → click a contact → `DetailDrawer` opens with full detail.

- [ ] **Step 3: Numbers match.** Confirm the bar heights match an `aggregate` sanity check (e.g. ask `dame el conteo exacto de leads por fuente en tabla` and compare to the chart).

- [ ] **Step 4: Line.** Ask: `muéstrame la tendencia de leads creados por semana`
Expected: a line chart over ordered time buckets.

- [ ] **Step 5: Pie.** Ask: `distribución de oportunidades por etapa`
Expected: a donut/pie chart; hovering a slice shows its label + value.

- [ ] **Step 6: History survives tab switch.** With a chart on screen, switch to **Marketing**, then back to **Asistente IA**.
Expected: the chart (and whole conversation) is still there — it lives in the persisted message blocks and the tab is kept mounted (hidden) per the earlier fix.

- [ ] **Step 7: Non-drillable safety.** If a chart has groups without `contactIds` (e.g. the weekly trend), confirm clicking does nothing and no "Haz clic…" hint/cursor appears for those.

- [ ] **Step 7b: Cap disclaimer.** For a drillable chart, confirm the hint reads "…ver los contactos (hasta 50 por grupo)." Force a large group (e.g. a source with >50 leads), click it, and confirm the drawer lists at most 50 contacts.

- [ ] **Step 8: Final typecheck.**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output (clean pass).

---

## Notes for the implementer

- **No automated tests** exist in this repo (CLAUDE.md). Verification is `npx tsc --noEmit` + the manual steps in Task 5. Do not scaffold a test framework.
- **Recharts typing:** `CategoricalChartState` is not exported. If the chart-level `onClick` param won't typecheck, widen it to `any` (the single acceptable exception) rather than fighting the types.
- **Do not** wire any change into `hooks/use-agent-loop.ts` — `render_chart` is handled by the existing default `executeTool` path.
- **Chart rule compliance:** every chart uses `NonZeroTooltipContent` (required) and is drillable via `ChartDrillDrawer` when contact-backed (required) — matches the project's standing chart rules.
