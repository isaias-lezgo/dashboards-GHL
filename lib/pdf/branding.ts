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
export function hr(color: string = C.grisBorde, thickness = 0.5): ContentCanvas {
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
