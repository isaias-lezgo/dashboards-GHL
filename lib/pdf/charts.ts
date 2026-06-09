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
  const labels: Content = {
    columns: pts.map((p) => ({
      width: slot,
      text: String(p.value),
      fontSize: 7,
      color: C.grisMed,
      alignment: "center",
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
  const canvas: CanvasElement[] = [{ type: "rect", x: 0, y: 0, w: 1, h, color: C.blanco }];
  const rows: Content[] = [];
  pts.forEach((p, i) => {
    const y = 4 + i * rowH;
    const w = max > 0 ? (p.value / max) * trackW : 0;
    canvas.push({ type: "rect", x: trackX, y: y + 3, w: Math.max(1, w), h: 12, color: C.naranja });
  });
  pts.forEach((p, i) => {
    rows.push({
      columns: [
        { width: labelW, text: sanitizeBrand(p.label), fontSize: 8, color: C.grisMed },
        { width: "*", text: String(p.value), fontSize: 8, color: C.grisMed, alignment: "right" },
      ],
      margin: [0, i === 0 ? 4 : 8, 0, 0],
    });
  });
  return {
    stack: [
      ...(block.title ? [{ text: sanitizeBrand(block.title), style: "chartTitle" } as Content] : []),
      { canvas },
      { stack: rows, margin: [0, -h + 4, 0, 0] },
    ],
    margin: [0, 4, 0, 10],
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
