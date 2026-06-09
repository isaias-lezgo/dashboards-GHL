import type { Content, TableCell } from "pdfmake/interfaces";
import type { PdfBlock, CalloutStyle } from "./types";
import { C, sanitizeBrand, hr } from "./branding";
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
  const body: TableCell[][] = [
    headers.map((h) => ({ text: sanitizeBrand(h), style: "th", margin: [4, 4, 4, 4] as [number, number, number, number] })),
    ...rows.map((r) =>
      r.map((cell) => ({ text: sanitizeBrand(String(cell ?? "")), style: "td", margin: [4, 3, 4, 3] as [number, number, number, number] })),
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
