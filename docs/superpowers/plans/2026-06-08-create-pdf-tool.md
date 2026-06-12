# create_pdf Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (user preference) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the "Analizar IA" assistant a `create_pdf` tool that generates branded Lezgo Suite PDF reports (text, tables, KPIs, callouts, and vector charts) entirely client-side.

**Architecture:** The assistant emits a compact JSON document spec via a new `create_pdf` tool. `hooks/use-agent-loop.ts` intercepts it (like `export_csv`), and a new `lib/pdf/` module turns the spec into a pdfmake `docDefinition` with all Lezgo branding applied automatically, generates a Blob, and triggers a browser download. The assistant never describes layout/colors — only content — to keep token cost minimal.

**Tech Stack:** Next.js 15, TypeScript, pdfmake (new dependency, client-side), Anthropic tool use.

---

## Testing approach (read first)

This project has **no automated test runner** (see `CLAUDE.md`) and pdfmake renders in the browser. So:

- Each code task is verified with **`npx tsc --noEmit`** (type safety) — the primary gate.
- The full feature is verified **manually in the running app** in Task 9.
- `npm run build` ignores TS errors (see `next.config.mjs`), so do NOT rely on it for type checking — always use `npx tsc --noEmit`.

There are no `*.test.ts` files to write. Where a step says "verify", run the typecheck command shown.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/pdf/types.ts` | TypeScript types for the document spec (`PdfSpec`, blocks, chart shapes). |
| `lib/pdf/branding.ts` | Lezgo palette, pdfmake style dictionary, `sanitizeBrand`, cover builder, header/footer functions. |
| `lib/pdf/charts.ts` | Vector chart builders (bar vertical/horizontal/stacked/grouped, pie, line) returning pdfmake canvas nodes. |
| `lib/pdf/blocks.ts` | Convert each spec block (`heading`, `text`, `table`, `kpis`, `callout`, `chart`, …) into pdfmake content nodes. |
| `lib/pdf/build-pdf.ts` | Parse/validate the spec, assemble the `docDefinition`, generate the Blob, and `downloadPdf(spec)` entry point. |
| `lib/download.ts` | Add `triggerBlobDownload` (pdfmake yields a Blob, not a string). |
| `lib/ai-tools.ts` | Add `create_pdf` to `TOOL_DEFINITIONS`. |
| `hooks/use-agent-loop.ts` | Intercept `create_pdf`, call `downloadPdf`, return a minimal result. |
| `lib/ai-context.ts` | Add a `# Documentos PDF (create_pdf)` section to `ASSISTANT_SYSTEM_PROMPT`. |

---

## Task 1: Dependency, spec types, and Blob download helper

**Files:**
- Modify: `package.json` (add `pdfmake` + `@types/pdfmake`)
- Create: `lib/pdf/types.ts`
- Modify: `lib/download.ts`

- [ ] **Step 1: Install pdfmake**

Run:
```bash
npm install pdfmake && npm install --save-dev @types/pdfmake
```
Expected: both packages added to `package.json`, no install errors.

- [ ] **Step 2: Create the spec types**

Create `lib/pdf/types.ts`:
```ts
// Document spec the AI emits via the create_pdf tool. Compact by design:
// the AI sends only content; lib/pdf/* applies all Lezgo branding.

export type CalloutStyle = "info" | "warn" | "ok" | "error";

/** Simple single-series point (same shape the AI already uses in render_chart). */
export interface SimpleSeriesPoint {
  label: string;
  value: number;
}

/** One series of a multi-series chart (stacked/grouped bar, multi-line). */
export interface MultiSeries {
  name: string;
  values: number[];
}

export interface PdfChartBlock {
  t: "chart";
  type: "bar" | "pie" | "line";
  title?: string;
  /** Tooltip/axis label, e.g. "Leads" or "Valor (MXN)". */
  valueLabel?: string;
  /** Bar only: "h" = horizontal. Default vertical. */
  orientation?: "h" | "v";
  /** Bar/line multi-series only: stack segments. Default grouped (side-by-side). */
  stacked?: boolean;
  /**
   * Present => multi-series form. X-axis category labels; each MultiSeries.values
   * is aligned to this array by index.
   */
  categories?: string[];
  /**
   * Simple form: SimpleSeriesPoint[]. Multi-series form: MultiSeries[] (when
   * `categories` is present). Discriminated at runtime by `categories`.
   */
  series: SimpleSeriesPoint[] | MultiSeries[];
}

export type PdfBlock =
  | { t: "heading"; text: string }
  | { t: "subheading"; text: string }
  | { t: "text"; text: string }
  | { t: "bullets"; items: string[] }
  | { t: "kpis"; items: { label: string; value: string }[] }
  | { t: "table"; headers: string[]; rows: string[][] }
  | { t: "callout"; style: CalloutStyle; text: string }
  | PdfChartBlock;

export interface PdfSpec {
  title: string;
  /** Orange accent line on the cover (optional 3rd title line). */
  accent?: string;
  /** Client name shown in the orange cover box. */
  client?: string;
  /** Short cover description paragraph. */
  subtitle?: string;
  /** Render a cover page. Default true. */
  cover?: boolean;
  blocks: PdfBlock[];
}
```

- [ ] **Step 3: Add the Blob download helper**

In `lib/download.ts`, append after the existing `triggerDownload` function:
```ts
// Variant for binary artifacts (e.g. a generated PDF) where the source is
// already a Blob rather than a string. Same transient-anchor mechanism.
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). `lib/pdf/types.ts` is type-only so it compiles standalone.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/pdf/types.ts lib/download.ts
git commit -m "feat(pdf): add pdfmake dep, spec types, and blob download helper"
```

---

## Task 2: Branding module (palette, styles, sanitize, cover, header/footer)

**Files:**
- Create: `lib/pdf/branding.ts`

Page geometry: LETTER is 612×792 pt. Margins `[40, 70, 40, 55]` → usable width `612 - 80 = 532`. Header is drawn inside the top margin; footer inside the bottom margin. Cover page (page 1) gets no header/footer.

- [ ] **Step 1: Create branding.ts**

Create `lib/pdf/branding.ts`:
```ts
import type { Content, StyleDictionary, ContentCanvas } from "pdfmake/interfaces";

// ─── Palette (ported from crear-documentos-lezgosuite.md) ──────────────────────
export const C = {
  naranja: "#F59B1B",
  naranjaOsc: "#D4820E",
  naranjaClar: "#FEF3E2",
  naranjaBord: "#FBCF86",
  azul: "#335577",
  negro: "#0A0A0A",
  negroText: "#1A1A1A",
  grisMed: "#4B5563",
  grisSuave: "#6B7280",
  grisFondo: "#F9FAFB",
  grisBorde: "#E5E7EB",
  blanco: "#FFFFFF",
  verde: "#065F46",
  verdeClaro: "#D1FAE5",
  verdeBorde: "#6EE7B7",
  rojoClaro: "#FEE2E2",
  rojoText: "#991B1B",
  amarilloBg: "#FEF9F0",
  amarilloBrd: "#FBCF86",
  amarilloTxt: "#92400E",
} as const;

// Color ramp for multi-series chart segments.
export const SERIES_COLORS = [
  C.naranja, C.azul, C.verde, C.naranjaOsc, C.grisSuave, C.amarilloTxt, C.rojoText,
];

export const PAGE_MARGINS: [number, number, number, number] = [40, 70, 40, 55];
export const USABLE_WIDTH = 612 - PAGE_MARGINS[0] - PAGE_MARGINS[2]; // 532

// ─── Brand rule: never print GoHighLevel / GHL ─────────────────────────────────
export function sanitizeBrand(text: string): string {
  if (!text) return text;
  return text
    .replace(/\bGoHighLevel\b/gi, "Lezgo Suite CRM")
    .replace(/\bGHL\b/g, "Lezgo Suite CRM");
}

// ─── pdfmake style dictionary ──────────────────────────────────────────────────
export const STYLES: StyleDictionary = {
  heading: { fontSize: 14, bold: true, color: C.naranja, margin: [0, 14, 0, 2] },
  subheading: { fontSize: 11, bold: true, color: C.azul, margin: [0, 10, 0, 2] },
  body: { fontSize: 10, color: C.grisMed, lineHeight: 1.35, margin: [0, 0, 0, 5] },
  th: { fontSize: 9.5, bold: true, color: C.blanco },
  td: { fontSize: 9.5, color: C.grisMed },
  kpiValue: { fontSize: 18, bold: true, color: C.negroText },
  kpiLabel: { fontSize: 8, color: C.grisSuave },
  chartTitle: { fontSize: 11, bold: true, color: C.azul, margin: [0, 8, 0, 4] },
  coverWordmark: { fontSize: 10, bold: true, color: C.naranja, characterSpacing: 2 },
  coverTitle: { fontSize: 34, bold: true, color: C.negroText, lineHeight: 1.05 },
  coverAccent: { fontSize: 34, bold: true, color: C.naranja, lineHeight: 1.05 },
  coverClient: { fontSize: 13, bold: true, color: C.blanco },
  coverDesc: { fontSize: 10.5, color: C.grisMed, lineHeight: 1.3 },
  coverFoot: { fontSize: 9, color: C.naranja, bold: true },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Full-width horizontal rule. */
export function hr(color = C.grisBorde, thickness = 0.5): ContentCanvas {
  return {
    canvas: [
      { type: "line", x1: 0, y1: 0, x2: USABLE_WIDTH, y2: 0, lineWidth: thickness, lineColor: color },
    ],
    margin: [0, 2, 0, 8],
  };
}

// ─── Cover page ────────────────────────────────────────────────────────────────
export function buildCover(spec: {
  title: string;
  accent?: string;
  client?: string;
  subtitle?: string;
}): Content[] {
  const out: Content[] = [];
  // Top orange bar
  out.push({
    canvas: [{ type: "rect", x: 0, y: 0, w: USABLE_WIDTH, h: 9, color: C.naranja }],
    margin: [0, 30, 0, 18],
  });
  out.push({ text: "LEZGO SUITE", style: "coverWordmark", margin: [0, 0, 0, 14] });
  out.push(hr(C.grisBorde, 1));
  out.push({ text: sanitizeBrand(spec.title), style: "coverTitle", margin: [0, 18, 0, 0] });
  if (spec.accent) out.push({ text: sanitizeBrand(spec.accent), style: "coverAccent" });
  // Client box
  if (spec.client) {
    out.push({
      table: {
        widths: ["*"],
        body: [[{ text: `para  ${sanitizeBrand(spec.client)}`, style: "coverClient", margin: [12, 8, 12, 8] }]],
      },
      layout: { defaultBorder: false, fillColor: () => C.naranja },
      margin: [0, 20, 0, 0],
    });
  }
  if (spec.subtitle) {
    out.push({ text: sanitizeBrand(spec.subtitle), style: "coverDesc", margin: [0, 18, 0, 0] });
  }
  out.push(hr(C.grisBorde, 1));
  out.push({
    columns: [
      { text: "lezgosuite.com", style: "coverFoot" },
      { text: "Documento Confidencial", color: C.grisSuave, fontSize: 9, alignment: "right" },
    ],
    margin: [0, 8, 0, 0],
  });
  out.push({ text: "", pageBreak: "after" });
  return out;
}

// ─── Header / Footer (suppressed on the cover, page 1) ─────────────────────────
export function header(currentPage: number): Content | undefined {
  if (currentPage <= 1) return undefined;
  return {
    margin: [40, 22, 40, 0],
    stack: [
      {
        columns: [
          {
            canvas: [{ type: "rect", x: 0, y: 0, w: 78, h: 16, color: C.naranja }],
            width: 78,
          },
          { text: "", width: 8 },
          { text: "Reporte · Lezgo Suite", fontSize: 8, bold: true, color: C.negroText, margin: [0, 3, 0, 0] },
        ],
      },
      {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: USABLE_WIDTH, y2: 0, lineWidth: 1.5, lineColor: C.naranja }],
        margin: [0, 4, 0, 0],
      },
      // Wordmark text overlaid on the orange block
      { text: "LEZGO SUITE", fontSize: 6.5, bold: true, color: C.blanco, absolutePosition: { x: 48, y: 27 } },
    ],
  };
}

export function footer(currentPage: number, pageCount: number): Content | undefined {
  if (currentPage <= 1) return undefined;
  return {
    margin: [40, 6, 40, 0],
    columns: [
      { text: "lezgosuite.com", fontSize: 7.5, color: C.grisSuave },
      { text: `${currentPage} / ${pageCount}`, fontSize: 8, bold: true, color: C.naranja, alignment: "center" },
      { text: "Documento Confidencial", fontSize: 7.5, color: C.grisSuave, alignment: "right" },
    ],
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS. If `pdfmake/interfaces` types are missing, confirm `@types/pdfmake` is installed (Task 1).

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/branding.ts
git commit -m "feat(pdf): Lezgo branding — palette, styles, cover, header/footer, sanitize"
```

---

## Task 3: Vector charts

**Files:**
- Create: `lib/pdf/charts.ts`

Charts are drawn with pdfmake `canvas` primitives inside a fixed box. Width = `USABLE_WIDTH` (532), plot height = 180. Each chart returns a `Content` stack: a title + the canvas + (for multi-series) a legend.

- [ ] **Step 1: Create charts.ts**

Create `lib/pdf/charts.ts`:
```ts
import type { Content, CanvasElement } from "pdfmake/interfaces";
import type { PdfChartBlock, SimpleSeriesPoint, MultiSeries } from "./types";
import { C, SERIES_COLORS, USABLE_WIDTH, sanitizeBrand } from "./branding";

const PLOT_H = 180;
const PAD_LEFT = 34;
const PAD_BOTTOM = 22;
const PAD_TOP = 8;
const PLOT_W = USABLE_WIDTH - PAD_LEFT - 8;

function isMulti(block: PdfChartBlock): boolean {
  return Array.isArray(block.categories) && block.categories.length > 0;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function legend(names: string[]): Content {
  return {
    columns: names.map((name, i) => ({
      width: "auto",
      columns: [
        { canvas: [{ type: "rect", x: 0, y: 2, w: 8, h: 8, color: SERIES_COLORS[i % SERIES_COLORS.length] }], width: 12 },
        { text: sanitizeBrand(name), fontSize: 8, color: C.grisMed, margin: [0, 1, 10, 0] },
      ],
    })),
    margin: [PAD_LEFT, 4, 0, 0],
  };
}

function wrap(canvas: CanvasElement[], block: PdfChartBlock, legendNames?: string[]): Content {
  const stack: Content[] = [];
  if (block.title) stack.push({ text: sanitizeBrand(block.title), style: "chartTitle" });
  stack.push({ canvas });
  if (legendNames && legendNames.length) stack.push(legend(legendNames));
  return { stack, margin: [0, 4, 0, 10], unbreakable: true };
}

// ─── simple vertical bar ───────────────────────────────────────────────────────
function barVertical(block: PdfChartBlock): Content {
  const pts = block.series as SimpleSeriesPoint[];
  const max = niceMax(Math.max(0, ...pts.map((p) => p.value)));
  const slot = PLOT_W / Math.max(1, pts.length);
  const bw = Math.min(48, slot * 0.6);
  const canvas: CanvasElement[] = [
    { type: "line", x1: PAD_LEFT, y1: PAD_TOP, x2: PAD_LEFT, y2: PAD_TOP + PLOT_H, lineWidth: 0.5, lineColor: C.grisBorde },
    { type: "line", x1: PAD_LEFT, y1: PAD_TOP + PLOT_H, x2: PAD_LEFT + PLOT_W, y2: PAD_TOP + PLOT_H, lineWidth: 0.5, lineColor: C.grisBorde },
  ];
  pts.forEach((p, i) => {
    const h = max > 0 ? (p.value / max) * PLOT_H : 0;
    const x = PAD_LEFT + i * slot + (slot - bw) / 2;
    const y = PAD_TOP + PLOT_H - h;
    canvas.push({ type: "rect", x, y, w: bw, h, color: C.naranja });
  });
  // value + category labels via text canvas overlay is not supported; use a
  // columns row beneath instead.
  const labels: Content = {
    columns: pts.map((p) => ({
      width: slot,
      stack: [
        { text: String(p.value), fontSize: 7, color: C.grisMed, alignment: "center" },
      ],
    })),
    margin: [PAD_LEFT, -16, 0, 0],
  };
  const cats: Content = {
    columns: pts.map((p) => ({
      width: slot,
      text: sanitizeBrand(p.label),
      fontSize: 7,
      color: C.grisSuave,
      alignment: "center",
    })),
    margin: [PAD_LEFT, 2, 0, 0],
  };
  return {
    stack: [
      ...(block.title ? [{ text: sanitizeBrand(block.title), style: "chartTitle" } as Content] : []),
      { canvas },
      labels,
      cats,
    ],
    margin: [0, 4, 0, 10],
    unbreakable: true,
  };
}

// ─── simple horizontal bar ─────────────────────────────────────────────────────
function barHorizontal(block: PdfChartBlock): Content {
  const pts = block.series as SimpleSeriesPoint[];
  const max = niceMax(Math.max(0, ...pts.map((p) => p.value)));
  const rowH = 22;
  const h = pts.length * rowH + 8;
  const labelW = 110;
  const trackX = labelW + 6;
  const trackW = USABLE_WIDTH - trackX - 34;
  const canvas: CanvasElement[] = [];
  const rows: Content[] = [];
  pts.forEach((p, i) => {
    const y = 4 + i * rowH;
    const w = max > 0 ? (p.value / max) * trackW : 0;
    canvas.push({ type: "rect", x: trackX, y: y + 3, w: Math.max(1, w), h: 12, color: C.naranja });
  });
  pts.forEach((p, i) => {
    rows.push({
      columns: [
        { width: labelW, text: sanitizeBrand(p.label), fontSize: 8, color: C.grisMed, margin: [0, 0, 0, 0] },
        { width: "*", text: String(p.value), fontSize: 8, color: C.grisMed, alignment: "right" },
      ],
      margin: [0, i === 0 ? 4 : 8, 0, 0],
    });
  });
  return {
    stack: [
      ...(block.title ? [{ text: sanitizeBrand(block.title), style: "chartTitle" } as Content] : []),
      { canvas: [{ type: "rect", x: 0, y: 0, w: 1, h, color: "#FFFFFF" }, ...canvas] },
      { stack: rows, absolutePosition: undefined, margin: [0, -h + 4, 0, 0] },
    ],
    margin: [0, 4, 0, 10],
    unbreakable: true,
  };
}

// ─── stacked / grouped bar (multi-series) ──────────────────────────────────────
function barMulti(block: PdfChartBlock): Content {
  const cats = block.categories!;
  const series = block.series as MultiSeries[];
  const stacked = block.stacked === true;
  const totals = cats.map((_, ci) =>
    stacked ? series.reduce((s, ser) => s + (ser.values[ci] ?? 0), 0) : Math.max(0, ...series.map((ser) => ser.values[ci] ?? 0)),
  );
  const max = niceMax(Math.max(1, ...totals));
  const slot = PLOT_W / Math.max(1, cats.length);
  const groupW = Math.min(60, slot * 0.7);
  const canvas: CanvasElement[] = [
    { type: "line", x1: PAD_LEFT, y1: PAD_TOP, x2: PAD_LEFT, y2: PAD_TOP + PLOT_H, lineWidth: 0.5, lineColor: C.grisBorde },
    { type: "line", x1: PAD_LEFT, y1: PAD_TOP + PLOT_H, x2: PAD_LEFT + PLOT_W, y2: PAD_TOP + PLOT_H, lineWidth: 0.5, lineColor: C.grisBorde },
  ];
  cats.forEach((_, ci) => {
    const baseX = PAD_LEFT + ci * slot + (slot - groupW) / 2;
    if (stacked) {
      let yCursor = PAD_TOP + PLOT_H;
      series.forEach((ser, si) => {
        const v = ser.values[ci] ?? 0;
        const h = max > 0 ? (v / max) * PLOT_H : 0;
        yCursor -= h;
        canvas.push({ type: "rect", x: baseX, y: yCursor, w: groupW, h, color: SERIES_COLORS[si % SERIES_COLORS.length] });
      });
    } else {
      const bw = groupW / Math.max(1, series.length);
      series.forEach((ser, si) => {
        const v = ser.values[ci] ?? 0;
        const h = max > 0 ? (v / max) * PLOT_H : 0;
        const x = baseX + si * bw;
        canvas.push({ type: "rect", x, y: PAD_TOP + PLOT_H - h, w: bw - 1, h, color: SERIES_COLORS[si % SERIES_COLORS.length] });
      });
    }
  });
  const catRow: Content = {
    columns: cats.map((c) => ({ width: slot, text: sanitizeBrand(c), fontSize: 7, color: C.grisSuave, alignment: "center" })),
    margin: [PAD_LEFT, 2, 0, 0],
  };
  return {
    stack: [
      ...(block.title ? [{ text: sanitizeBrand(block.title), style: "chartTitle" } as Content] : []),
      { canvas },
      catRow,
      legend(series.map((s) => s.name)),
    ],
    margin: [0, 4, 0, 10],
    unbreakable: true,
  };
}

// ─── pie ───────────────────────────────────────────────────────────────────────
function pie(block: PdfChartBlock): Content {
  const pts = block.series as SimpleSeriesPoint[];
  const total = pts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const cx = 100;
  const cy = PAD_TOP + 90;
  const r = 80;
  const canvas: CanvasElement[] = [];
  let a0 = -Math.PI / 2;
  pts.forEach((p, i) => {
    const frac = total > 0 ? Math.max(0, p.value) / total : 0;
    const a1 = a0 + frac * Math.PI * 2;
    // Approximate the sector with a filled polyline fan.
    const steps = Math.max(2, Math.ceil(frac * 40));
    const points: { x: number; y: number }[] = [{ x: cx, y: cy }];
    for (let s = 0; s <= steps; s++) {
      const a = a0 + (a1 - a0) * (s / steps);
      points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    canvas.push({ type: "polyline", closePath: true, color: SERIES_COLORS[i % SERIES_COLORS.length], points });
    a0 = a1;
  });
  const rows: Content[] = pts.map((p, i) => ({
    columns: [
      { canvas: [{ type: "rect", x: 0, y: 2, w: 8, h: 8, color: SERIES_COLORS[i % SERIES_COLORS.length] }], width: 12 },
      { text: sanitizeBrand(p.label), fontSize: 8, color: C.grisMed, width: "*" },
      { text: total > 0 ? `${Math.round((p.value / total) * 100)}%` : "0%", fontSize: 8, bold: true, color: C.negroText, width: 34, alignment: "right" },
    ],
    margin: [0, i === 0 ? 0 : 4, 0, 0],
  }));
  return {
    stack: [
      ...(block.title ? [{ text: sanitizeBrand(block.title), style: "chartTitle" } as Content] : []),
      {
        columns: [
          { width: 210, canvas },
          { width: "*", stack: rows, margin: [10, PAD_TOP + 20, 0, 0] },
        ],
      },
    ],
    margin: [0, 4, 0, 10],
    unbreakable: true,
  };
}

// ─── line (mono or multi-series) ───────────────────────────────────────────────
function line(block: PdfChartBlock): Content {
  const multi = isMulti(block);
  const cats = multi ? block.categories! : (block.series as SimpleSeriesPoint[]).map((p) => p.label);
  const seriesList: { name: string; values: number[] }[] = multi
    ? (block.series as MultiSeries[]).map((s) => ({ name: s.name, values: s.values }))
    : [{ name: block.valueLabel ?? "Valor", values: (block.series as SimpleSeriesPoint[]).map((p) => p.value) }];
  const max = niceMax(Math.max(1, ...seriesList.flatMap((s) => s.values)));
  const n = Math.max(1, cats.length - 1);
  const xAt = (i: number) => PAD_LEFT + (i / n) * PLOT_W;
  const yAt = (v: number) => PAD_TOP + PLOT_H - (max > 0 ? (v / max) * PLOT_H : 0);
  const canvas: CanvasElement[] = [
    { type: "line", x1: PAD_LEFT, y1: PAD_TOP, x2: PAD_LEFT, y2: PAD_TOP + PLOT_H, lineWidth: 0.5, lineColor: C.grisBorde },
    { type: "line", x1: PAD_LEFT, y1: PAD_TOP + PLOT_H, x2: PAD_LEFT + PLOT_W, y2: PAD_TOP + PLOT_H, lineWidth: 0.5, lineColor: C.grisBorde },
  ];
  seriesList.forEach((s, si) => {
    const color = SERIES_COLORS[si % SERIES_COLORS.length];
    const points = s.values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    canvas.push({ type: "polyline", lineWidth: 1.5, lineColor: color, points });
  });
  const catRow: Content = {
    columns: cats.map((c) => ({ width: PLOT_W / cats.length, text: sanitizeBrand(c), fontSize: 6.5, color: C.grisSuave, alignment: "center" })),
    margin: [PAD_LEFT, 2, 0, 0],
  };
  return {
    stack: [
      ...(block.title ? [{ text: sanitizeBrand(block.title), style: "chartTitle" } as Content] : []),
      { canvas },
      catRow,
      ...(multi ? [legend(seriesList.map((s) => s.name))] : []),
    ],
    margin: [0, 4, 0, 10],
    unbreakable: true,
  };
}

/** Entry point: turn a chart block into a pdfmake Content node. */
export function buildChart(block: PdfChartBlock): Content {
  if (block.type === "pie") return pie(block);
  if (block.type === "line") return line(block);
  // bar
  if (isMulti(block)) return barMulti(block);
  if (block.orientation === "h") return barHorizontal(block);
  return barVertical(block);
}
```

> Note: pdfmake's `unbreakable` keeps each chart on one page. If `unbreakable` is not in the installed `@types/pdfmake`, replace `unbreakable: true` with `{ ... }` wrapped in `{ stack: [...], }` — but current pdfmake supports it. Verify in Step 2.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS. If `unbreakable` errors, remove that property from each return (charts still render, just may split across pages).

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/charts.ts
git commit -m "feat(pdf): vector charts — bar (v/h/stacked/grouped), pie, line"
```

---

## Task 4: Block renderers

**Files:**
- Create: `lib/pdf/blocks.ts`

- [ ] **Step 1: Create blocks.ts**

Create `lib/pdf/blocks.ts`:
```ts
import type { Content } from "pdfmake/interfaces";
import type { PdfBlock, CalloutStyle } from "./types";
import { C, USABLE_WIDTH, sanitizeBrand, hr } from "./branding";
import { buildChart } from "./charts";

const CALLOUT: Record<CalloutStyle, { bg: string; text: string }> = {
  info: { bg: C.naranjaClar, text: C.amarilloTxt },
  warn: { bg: C.amarilloBg, text: C.amarilloTxt },
  ok: { bg: C.verdeClaro, text: C.verde },
  error: { bg: C.rojoClaro, text: C.rojoText },
};

// Minimal **bold** inline parser → pdfmake text runs.
function inline(text: string): Content {
  const parts = sanitizeBrand(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return {
    text: parts.map((p) =>
      p.startsWith("**") && p.endsWith("**")
        ? { text: p.slice(2, -2), bold: true }
        : { text: p },
    ),
    style: "body",
  };
}

function kpis(items: { label: string; value: string }[]): Content {
  return {
    columns: items.map((it) => ({
      width: "*",
      table: {
        widths: ["*"],
        body: [
          [{ text: sanitizeBrand(it.value), style: "kpiValue", alignment: "center", margin: [4, 8, 4, 0] }],
          [{ text: sanitizeBrand(it.label), style: "kpiLabel", alignment: "center", margin: [4, 0, 4, 8] }],
        ],
      },
      layout: {
        defaultBorder: false,
        fillColor: () => C.grisFondo,
        // orange top accent
        hLineWidth: (i: number) => (i === 0 ? 2 : 0),
        hLineColor: () => C.naranja,
      },
      margin: [3, 0, 3, 0],
    })),
    columnGap: 0,
    margin: [0, 4, 0, 8],
  };
}

function table(headers: string[], rows: string[][]): Content {
  const body = [
    headers.map((h) => ({ text: sanitizeBrand(h), style: "th", margin: [4, 4, 4, 4] })),
    ...rows.map((r) =>
      r.map((cell) => ({ text: sanitizeBrand(String(cell ?? "")), style: "td", margin: [4, 3, 4, 3] })),
    ),
  ];
  return {
    table: { headerRows: 1, widths: headers.map(() => "*"), body },
    layout: {
      fillColor: (rowIndex: number) =>
        rowIndex === 0 ? C.azul : rowIndex % 2 === 0 ? C.grisFondo : null,
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => C.grisBorde,
    },
    margin: [0, 4, 0, 8],
  };
}

function callout(style: CalloutStyle, text: string): Content {
  const c = CALLOUT[style] ?? CALLOUT.info;
  return {
    table: {
      widths: ["*"],
      body: [[{ text: sanitizeBrand(text), fontSize: 9.5, color: c.text, margin: [12, 8, 12, 8] }]],
    },
    layout: { defaultBorder: false, fillColor: () => c.bg },
    margin: [0, 4, 0, 8],
  };
}

/** Convert one spec block into pdfmake content. Returns null for unknown blocks. */
export function buildBlock(block: PdfBlock): Content | null {
  switch (block.t) {
    case "heading":
      return { stack: [{ text: sanitizeBrand(block.text), style: "heading" }, hr(C.naranja, 1.2)] };
    case "subheading":
      return { text: sanitizeBrand(block.text), style: "subheading" };
    case "text":
      return inline(block.text);
    case "bullets":
      return { ul: block.items.map((i) => sanitizeBrand(i)), style: "body", margin: [0, 0, 0, 6] };
    case "kpis":
      return kpis(block.items);
    case "table":
      return table(block.headers, block.rows);
    case "callout":
      return callout(block.style, block.text);
    case "chart":
      return buildChart(block);
    default:
      return null;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/blocks.ts
git commit -m "feat(pdf): block renderers — heading, text, bullets, kpis, table, callout, chart"
```

---

## Task 5: Spec validation, docDefinition assembly, and downloadPdf entry point

**Files:**
- Create: `lib/pdf/build-pdf.ts`

- [ ] **Step 1: Create build-pdf.ts**

Create `lib/pdf/build-pdf.ts`:
```ts
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";
import type { PdfSpec, PdfBlock } from "./types";
import { STYLES, PAGE_MARGINS, buildCover, header, footer, C } from "./branding";
import { buildBlock } from "./blocks";
import { triggerBlobDownload } from "@/lib/download";

export interface PdfResult {
  success: boolean;
  filename?: string;
  pages?: number;
  error?: string;
}

const VALID_T = new Set([
  "heading", "subheading", "text", "bullets", "kpis", "table", "callout", "chart",
]);

/** Validate the raw tool input into a PdfSpec. Returns null if unusable. */
export function parsePdfSpec(input: unknown): PdfSpec | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : null;
  if (!title) return null;
  if (!Array.isArray(o.blocks)) return null;

  const blocks: PdfBlock[] = [];
  for (const raw of o.blocks) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    if (typeof b.t !== "string" || !VALID_T.has(b.t)) continue;
    blocks.push(b as unknown as PdfBlock);
  }
  if (blocks.length === 0) return null;

  return {
    title,
    accent: typeof o.accent === "string" ? o.accent : undefined,
    client: typeof o.client === "string" ? o.client : undefined,
    subtitle: typeof o.subtitle === "string" ? o.subtitle : undefined,
    cover: o.cover === false ? false : true,
    blocks,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "reporte";
}

export function buildDocDefinition(spec: PdfSpec): TDocumentDefinitions {
  const content: Content[] = [];
  if (spec.cover !== false) {
    content.push(...buildCover(spec));
  }
  for (const block of spec.blocks) {
    const node = buildBlock(block);
    if (node) content.push(node);
  }
  return {
    pageSize: "LETTER",
    pageMargins: PAGE_MARGINS,
    defaultStyle: { fontSize: 10, color: C.grisMed },
    styles: STYLES,
    header: (currentPage: number) => header(currentPage) ?? "",
    footer: (currentPage: number, pageCount: number) => footer(currentPage, pageCount) ?? "",
    content,
  };
}

// Lazy-load pdfmake + fonts only in the browser, on first use, to keep them out
// of the server bundle and the initial client chunk.
async function getPdfMake() {
  const pdfMakeMod = await import("pdfmake/build/pdfmake");
  const pdfFontsMod = await import("pdfmake/build/vfs_fonts");
  const pdfMake = (pdfMakeMod as unknown as { default?: unknown }).default ?? pdfMakeMod;
  // vfs shape differs across pdfmake versions; handle both.
  const fonts = pdfFontsMod as unknown as {
    pdfMake?: { vfs?: Record<string, string> };
    default?: { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> };
    vfs?: Record<string, string>;
  };
  const vfs =
    fonts.pdfMake?.vfs ?? fonts.default?.pdfMake?.vfs ?? fonts.default?.vfs ?? fonts.vfs;
  const pm = pdfMake as unknown as { vfs?: Record<string, string>; createPdf: (d: TDocumentDefinitions) => { getBlob: (cb: (b: Blob) => void) => void } };
  if (vfs) pm.vfs = vfs;
  return pm;
}

/** Build the PDF from a raw tool input and trigger a browser download. */
export async function downloadPdf(input: unknown): Promise<PdfResult> {
  const spec = parsePdfSpec(input);
  if (!spec) return { success: false, error: "Spec inválido o sin bloques." };

  try {
    const docDef = buildDocDefinition(spec);
    const pdfMake = await getPdfMake();
    const filename = `${slugify(spec.title)}.pdf`;
    const blob = await new Promise<Blob>((resolve) => {
      pdfMake.createPdf(docDef).getBlob((b: Blob) => resolve(b));
    });
    triggerBlobDownload(blob, filename);
    return { success: true, filename, pages: spec.blocks.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS. If the dynamic `import("pdfmake/build/vfs_fonts")` has no type declarations and errors, add a module declaration file `lib/pdf/pdfmake-vfs.d.ts` with:
```ts
declare module "pdfmake/build/vfs_fonts";
declare module "pdfmake/build/pdfmake";
```
Then re-run `npx tsc --noEmit` → PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/build-pdf.ts lib/pdf/pdfmake-vfs.d.ts 2>/dev/null; git add lib/pdf
git commit -m "feat(pdf): spec validation, docDefinition assembly, downloadPdf entry"
```

---

## Task 6: Register the `create_pdf` tool

**Files:**
- Modify: `lib/ai-tools.ts` (add to `TOOL_DEFINITIONS`, after the `render_chart` entry near line 555)

- [ ] **Step 1: Add the tool definition**

In `lib/ai-tools.ts`, inside the `TOOL_DEFINITIONS` array, add this object immediately after the `render_chart` definition (after its closing `},` and before the array's closing `]`):
```ts
  {
    name: "create_pdf",
    description:
      "Genera un documento PDF descargable con el branding de Lezgo Suite (portada, encabezado y pie automáticos). Úsalo cuando el usuario pida un reporte, documento o PDF descargable. COMPÓN el documento SOLO con datos que YA obtuviste en esta conversación — NO hagas llamadas extra solo para el PDF. Reutiliza los `series` de tus `aggregate`/`relate` previos en los bloques `chart` (misma forma que render_chart). NUNCA escribas 'GoHighLevel' ni 'GHL' (se reescriben a 'Lezgo Suite CRM'). El branding (colores, portada, header/footer) es automático: tú solo envías contenido. Es tu paso FINAL; después confirma al usuario el nombre del archivo.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título de la portada (requerido)." },
        accent: { type: "string", description: "Línea naranja adicional en la portada (ej. 'Mayo 2026')." },
        client: { type: "string", description: "Nombre del cliente/empresa; aparece en la caja naranja de portada." },
        subtitle: { type: "string", description: "Descripción breve de la portada." },
        cover: { type: "boolean", description: "Incluir portada. Default true. Usa false para un documento interno corto." },
        blocks: {
          type: "array",
          description:
            "Contenido del documento, en orden. Cada bloque se discrimina por `t`: heading {t,text}, subheading {t,text}, text {t,text} (acepta **negrita**), bullets {t,items[]}, kpis {t,items:[{label,value}]}, table {t,headers[],rows[][]}, callout {t,style:'info|warn|ok|error',text}, chart (ver abajo).",
          items: {
            type: "object",
            properties: {
              t: {
                type: "string",
                enum: ["heading", "subheading", "text", "bullets", "kpis", "table", "callout", "chart"],
              },
              text: { type: "string", description: "Para heading/subheading/text/callout." },
              items: {
                type: "array",
                description: "bullets: array de strings. kpis: array de {label,value} (strings).",
              },
              style: { type: "string", enum: ["info", "warn", "ok", "error"], description: "Solo callout." },
              headers: { type: "array", items: { type: "string" }, description: "Solo table." },
              rows: { type: "array", description: "Solo table: array de filas; cada fila es array de strings." },
              type: { type: "string", enum: ["bar", "pie", "line"], description: "Solo chart." },
              title: { type: "string", description: "Solo chart: título de la gráfica." },
              valueLabel: { type: "string", description: "Solo chart: qué representan los números." },
              orientation: { type: "string", enum: ["h", "v"], description: "Solo chart bar: 'h' = barras horizontales." },
              stacked: { type: "boolean", description: "Solo chart bar/line multi-serie: apilar. Default agrupado." },
              categories: { type: "array", items: { type: "string" }, description: "Solo chart multi-serie: etiquetas del eje X." },
              series: {
                type: "array",
                description:
                  "chart simple: [{label,value}] (igual que render_chart). chart multi-serie (con categories): [{name, values:[number]}] alineado por índice a categories.",
              },
            },
            required: ["t"],
          },
        },
      },
      required: ["title", "blocks"],
    },
  },
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS. `TOOL_DEFINITIONS` stays `as const`; the new entry follows the existing literal shape.

- [ ] **Step 3: Commit**

```bash
git add lib/ai-tools.ts
git commit -m "feat(pdf): register create_pdf tool definition"
```

---

## Task 7: Wire create_pdf into the agent loop

**Files:**
- Modify: `hooks/use-agent-loop.ts` (import + new branch near line 204, alongside `export_csv`)

- [ ] **Step 1: Add the import**

In `hooks/use-agent-loop.ts`, add after the existing `import { triggerDownload } from "@/lib/download";` (line 15):
```ts
import { downloadPdf } from "@/lib/pdf/build-pdf";
```

- [ ] **Step 2: Add the create_pdf branch**

In the tool-dispatch chain (the `if (tu.name === ...) ... else if` block starting near line 196), add a new branch immediately after the `export_csv` branch (after its closing `}` near line 217, before the final `else {`):
```ts
                } else if (tu.name === "create_pdf") {
                  const pdfResult = await downloadPdf(tu.input);
                  result = pdfResult;
                }
```
The chain should now read: `... else if (tu.name === "export_csv") { ... } else if (tu.name === "create_pdf") { ... } else { result = executeTool(...); }`.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add hooks/use-agent-loop.ts
git commit -m "feat(pdf): execute create_pdf in the agent loop"
```

---

## Task 8: Teach the assistant when/how to use create_pdf

**Files:**
- Modify: `lib/ai-context.ts` (append a section to `ASSISTANT_SYSTEM_PROMPT`, before its closing `` `; `` at line 274)

- [ ] **Step 1: Append the PDF guidance**

In `lib/ai-context.ts`, locate the end of the `# Exportar a CSV` section (line 274 ends with `con 142 contactos."`` `;`). Insert the following block right before the closing backtick + semicolon, so it becomes part of the prompt string:
```ts
\n\n# Documentos PDF (create_pdf)

Cuando el usuario pida un reporte, documento o PDF descargable, usa \`create_pdf\` como paso FINAL.
- COMPÓN el documento SOLO con datos que YA obtuviste en esta conversación. NO hagas llamadas extra (search/aggregate/relate) solo para llenar el PDF — eso desperdicia tokens.
- Reutiliza directamente los \`series\` de tus \`aggregate\`/\`relate\` previos en los bloques \`chart\` (misma forma que \`render_chart\`). Para apiladas/agrupadas usa la forma multi-serie con \`categories\` + \`series:[{name,values}]\`.
- Estructura típica de un reporte: un bloque \`kpis\` con las cifras clave, \`heading\` por sección, \`text\` con hallazgos, \`table\` para desgloses, \`chart\` para comparaciones/tendencias, y \`callout\` para alertas o recomendaciones.
- El branding (portada, colores, header/pie) es automático. Tú solo envías \`title\`, \`blocks\` y, si aplica, \`client\`/\`accent\`/\`subtitle\`.
- NUNCA escribas "GoHighLevel" ni "GHL" — di "Lezgo Suite CRM".
- Tras generarlo, confirma al usuario el nombre del archivo. Ejemplo: "Listo — se descargó \`reporte-de-leads.pdf\`."
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (the template string stays valid; escaped backticks `\`` are literal backticks in the prompt).

- [ ] **Step 3: Commit**

```bash
git add lib/ai-context.ts
git commit -m "feat(pdf): system-prompt guidance for create_pdf"
```

---

## Task 9: Manual end-to-end verification

**Files:** none (manual)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server on http://localhost:3000, no compile errors in the terminal.

- [ ] **Step 2: Generate a report via the assistant**

In the "Analizar IA" chat, send:
> "Genera un PDF con un reporte de leads por fuente: incluye los KPIs, una tabla y una gráfica de barras."

Expected:
- The assistant calls `aggregate` (once) then `create_pdf`.
- A PDF file downloads automatically.
- The assistant confirms the filename in Spanish.

- [ ] **Step 3: Inspect the PDF**

Open the downloaded PDF. Verify:
- Cover page: orange top bar, "LEZGO SUITE" wordmark, title, optional client box — no header/footer on page 1.
- Interior pages: orange header with "LEZGO SUITE" block + "Reporte · Lezgo Suite"; footer with `page / total` in orange, "lezgosuite.com" left, "Documento Confidencial" right.
- Section headings in orange with a rule beneath; table header row in blue `#335577` with alternating row fills; KPI cards with orange top accent; the bar chart drawn in orange.
- No occurrence of "GoHighLevel" or "GHL" anywhere.

- [ ] **Step 4: Test a stacked chart**

Send:
> "Hazme un PDF con una gráfica apilada de leads por fuente y estatus."

Expected: the assistant emits a `chart` block with `categories` + multi-series `series`, and the PDF shows a stacked bar with a legend.

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "fix(pdf): adjustments from manual verification"
```
(Skip if no changes were needed.)

---

## Self-Review notes

- **Spec coverage:** objetivo/restricción de tokens (Tasks 6 + 8 — minimal result, prompt guidance), pdfmake client-side (Task 5), módulo `lib/pdf/` branding/blocks/charts/build (Tasks 2–5), 8 tipos de bloque (Task 4), gráficas bar/pie/line + apiladas (Task 3), regla de marca `sanitizeBrand` (Task 2, applied throughout), manejo de errores mínimo (Task 5 `parsePdfSpec` + try/catch), integración `use-agent-loop` (Task 7), dependencia nueva (Task 1). All spec sections map to a task.
- **Type consistency:** `PdfSpec`/`PdfBlock`/`PdfChartBlock` defined in Task 1 are the exact types consumed by `branding.ts` (`buildCover` uses a structural subset), `blocks.ts` (`buildBlock`), `charts.ts` (`buildChart`), and `build-pdf.ts` (`parsePdfSpec`/`buildDocDefinition`). `downloadPdf` (Task 5) is imported in Task 7. `triggerBlobDownload` (Task 1) is consumed in Task 5.
- **No placeholders:** every code step shows complete code; verification uses `npx tsc --noEmit` because the repo has no test runner (documented up top).
```
