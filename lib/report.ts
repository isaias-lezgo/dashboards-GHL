// Dashboard → PDF report composition. Reuses the create_pdf spec/renderer
// (lib/pdf/*) so exported reports share the exact branding/format the AI
// assistant produces; only the content source differs (deterministic code
// over the dashboards' already-computed aggregates instead of the model).

import type { PdfBlock, PdfSpec, PdfChartBlock } from "@/lib/pdf/types"

export interface ReportSection {
  id: string
  title: string
  /** Fixed one/two-sentence Spanish description of what the chart shows. */
  explanation: string
  /** Request AI analysis for this section. */
  ai?: boolean
  /** Data blocks (chart/table/kpis) already in PdfSpec form. */
  blocks: PdfBlock[]
}

export interface ReportInput {
  reportType: "marketing" | "ventas"
  title: string
  /** Human label of the active global date filter, e.g. "Últimos 30 días". */
  periodLabel?: string
  kpis: { label: string; value: string }[]
  sections: ReportSection[]
}

export interface ReportAiResult {
  summary?: string
  analyses?: Record<string, string>
}

/** Flatten a section's blocks into compact JSON for the AI payload. */
export function compactSectionData(section: ReportSection): unknown[] {
  return section.blocks.map((b) => {
    if (b.t === "chart") {
      const c = b as PdfChartBlock
      return { kind: "chart", type: c.type, title: c.title, categories: c.categories, series: c.series }
    }
    if (b.t === "table") {
      return { kind: "table", headers: b.headers, rows: b.rows.slice(0, 15) }
    }
    if (b.t === "kpis") {
      return { kind: "kpis", items: b.items }
    }
    return null
  }).filter(Boolean) as unknown[]
}

export function buildAnalyzePayload(input: ReportInput) {
  return {
    reportType: input.reportType,
    periodLabel: input.periodLabel,
    kpis: input.kpis,
    sections: input.sections
      .filter((s) => s.ai)
      .map((s) => ({ id: s.id, title: s.title, data: compactSectionData(s) })),
  }
}

export function buildReportSpec(input: ReportInput, ai: ReportAiResult | null): PdfSpec {
  const blocks: PdfBlock[] = []

  blocks.push({ t: "heading", text: "Resumen general" })
  if (input.periodLabel) {
    blocks.push({ t: "text", text: `Periodo del reporte: **${input.periodLabel}**.` })
  }
  blocks.push({ t: "kpis", items: input.kpis })

  if (ai?.summary) {
    blocks.push({ t: "heading", text: "Resumen ejecutivo (IA)" })
    blocks.push({ t: "text", text: ai.summary })
  } else {
    blocks.push({
      t: "callout",
      style: "warn",
      text: "El análisis IA no estuvo disponible al generar este reporte; se incluyen los datos y explicaciones de cada gráfico.",
    })
  }

  for (const s of input.sections) {
    blocks.push({ t: "heading", text: s.title })
    blocks.push({ t: "text", text: s.explanation })
    blocks.push(...s.blocks)
    const analysis = ai?.analyses?.[s.id]
    if (analysis) {
      blocks.push({ t: "callout", style: "info", text: `Análisis IA: ${analysis}` })
    }
  }

  return {
    title: input.title,
    accent: input.periodLabel,
    client: "Lezgo Suite",
    subtitle:
      input.reportType === "marketing"
        ? "Reporte de adquisición: fuentes, pautas, atribución y resultados de campañas."
        : "Reporte comercial: embudo, conversión, citas y análisis de pérdidas.",
    cover: true,
    blocks,
  }
}
