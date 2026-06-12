import type { Content, CanvasElement } from "pdfmake/interfaces";
import type { PdfChartBlock, SimpleSeriesPoint, MultiSeries } from "./types";
import { C, SERIES_COLORS, USABLE_WIDTH, sanitizeBrand } from "./branding";

const PLOT_H = 180;
const PAD_LEFT = 34;
const PAD_TOP = 8;
const PLOT_W = USABLE_WIDTH - PAD_LEFT - 8;

function isMulti(block: PdfChartBlock): boolean {
  return Array.isArray(block.categories) && block.categories.length > 0;
}

// Round up to the next half power of ten (109 → 150, 318 → 350) so the
// largest bar fills most of the plot instead of stranding at ~60%.
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const half = Math.pow(10, Math.floor(Math.log10(v))) / 2;
  return Math.ceil(v / half) * half;
}

/** Dashed horizontal gridlines at 25/50/75/100% of the plot height. */
function gridLines(): CanvasElement[] {
  return [0.25, 0.5, 0.75, 1].map((f) => ({
    type: "line" as const,
    x1: PAD_LEFT,
    y1: PAD_TOP + PLOT_H * (1 - f),
    x2: PAD_LEFT + PLOT_W,
    y2: PAD_TOP + PLOT_H * (1 - f),
    lineWidth: 0.5,
    lineColor: C.grisBorde,
    dash: { length: 2, space: 2 },
  }));
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

// ─── simple vertical bar ───────────────────────────────────────────────────────
function barVertical(block: PdfChartBlock): Content {
  const pts = block.series as SimpleSeriesPoint[];
  const max = niceMax(Math.max(0, ...pts.map((p) => p.value)));
  const slot = PLOT_W / Math.max(1, pts.length);
  const bw = Math.min(48, slot * 0.6);
  const canvas: CanvasElement[] = [
    ...gridLines(),
    { type: "line", x1: PAD_LEFT, y1: PAD_TOP, x2: PAD_LEFT, y2: PAD_TOP + PLOT_H, lineWidth: 0.5, lineColor: C.grisBorde },
    { type: "line", x1: PAD_LEFT, y1: PAD_TOP + PLOT_H, x2: PAD_LEFT + PLOT_W, y2: PAD_TOP + PLOT_H, lineWidth: 0.5, lineColor: C.grisBorde },
  ];
  pts.forEach((p, i) => {
    const h = max > 0 ? (p.value / max) * PLOT_H : 0;
    const x = PAD_LEFT + i * slot + (slot - bw) / 2;
    const y = PAD_TOP + PLOT_H - h;
    canvas.push({ type: "rect", x, y, w: bw, h, color: C.naranja });
  });
  const vals: Content = {
    columns: pts.map((p) => ({
      width: slot,
      text: String(p.value),
      fontSize: 7.5,
      bold: true,
      color: C.negroText,
      alignment: "center",
    })),
    margin: [PAD_LEFT, 3, 0, 0],
  };
  const cats: Content = {
    columns: pts.map((p) => ({
      width: slot,
      text: sanitizeBrand(p.label),
      fontSize: 7,
      color: C.grisSuave,
      alignment: "center",
    })),
    margin: [PAD_LEFT, 1, 0, 0],
  };
  return {
    stack: [
      ...(block.title ? [{ text: sanitizeBrand(block.title), style: "chartTitle" } as Content] : []),
      { canvas },
      vals,
      cats,
    ],
    unbreakable: true,
    margin: [0, 4, 0, 10],
  };
}

// ─── simple horizontal bar ─────────────────────────────────────────────────────
function barHorizontal(block: PdfChartBlock): Content {
  const pts = block.series as SimpleSeriesPoint[];
  const max = niceMax(Math.max(0, ...pts.map((p) => p.value)));
  const labelW = 120;
  const valueW = 34;
  const gap = 8;
  const barH = 11;
  const trackW = USABLE_WIDTH - labelW - valueW - gap * 2;
  // Each row holds its own bar canvas inline, so label / bar / value always
  // share a baseline and the chart flows normally (no canvas overlay tricks).
  const rows: Content[] = pts.map((p) => {
    const w = max > 0 ? (p.value / max) * trackW : 0;
    return {
      columns: [
        { width: labelW, text: sanitizeBrand(p.label), fontSize: 8, color: C.grisMed, lineHeight: 1.1, margin: [0, 1, 0, 0] },
        {
          width: "*",
          canvas: [
            { type: "rect", x: 0, y: 0, w: trackW, h: barH, r: 2, color: "#F3F4F6" },
            { type: "rect", x: 0, y: 0, w: Math.max(2, w), h: barH, r: 2, color: C.naranja },
          ] as CanvasElement[],
        },
        { width: valueW, text: String(p.value), fontSize: 8.5, bold: true, color: C.negroText, alignment: "right", margin: [0, 1, 0, 0] },
      ],
      columnGap: gap,
      margin: [0, 3, 0, 3],
    } as Content;
  });
  return {
    stack: [
      ...(block.title ? [{ text: sanitizeBrand(block.title), style: "chartTitle" } as Content] : []),
      ...rows,
    ],
    // Keep short charts on one page; very long ones may still flow.
    unbreakable: pts.length <= 20,
    margin: [0, 4, 0, 12],
  };
}

// ─── stacked / grouped bar (multi-series) ──────────────────────────────────────
function barMulti(block: PdfChartBlock): Content {
  const cats = block.categories!;
  const series = block.series as MultiSeries[];
  const stacked = block.stacked === true;
  const totals = cats.map((_, ci) =>
    stacked
      ? series.reduce((s, ser) => s + (ser.values[ci] ?? 0), 0)
      : Math.max(0, ...series.map((ser) => ser.values[ci] ?? 0)),
  );
  const max = niceMax(Math.max(1, ...totals));
  const slot = PLOT_W / Math.max(1, cats.length);
  const groupW = Math.min(60, slot * 0.7);
  const canvas: CanvasElement[] = [
    ...gridLines(),
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
    unbreakable: true,
    margin: [0, 4, 0, 10],
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
    unbreakable: true,
    margin: [0, 4, 0, 10],
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
  // Points sit at slot centers so they line up with the centered cat labels.
  const xAt = (i: number) => PAD_LEFT + ((i + 0.5) / Math.max(1, cats.length)) * PLOT_W;
  const yAt = (v: number) => PAD_TOP + PLOT_H - (max > 0 ? (v / max) * PLOT_H : 0);
  const canvas: CanvasElement[] = [
    ...gridLines(),
    { type: "line", x1: PAD_LEFT, y1: PAD_TOP, x2: PAD_LEFT, y2: PAD_TOP + PLOT_H, lineWidth: 0.5, lineColor: C.grisBorde },
    { type: "line", x1: PAD_LEFT, y1: PAD_TOP + PLOT_H, x2: PAD_LEFT + PLOT_W, y2: PAD_TOP + PLOT_H, lineWidth: 0.5, lineColor: C.grisBorde },
  ];
  seriesList.forEach((s, si) => {
    const color = SERIES_COLORS[si % SERIES_COLORS.length];
    const points = s.values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    canvas.push({ type: "polyline", lineWidth: 1.5, lineColor: color, points });
    points.forEach((pt) => {
      canvas.push({ type: "ellipse", x: pt.x, y: pt.y, r1: 2, r2: 2, color });
    });
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
    unbreakable: true,
    margin: [0, 4, 0, 10],
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
