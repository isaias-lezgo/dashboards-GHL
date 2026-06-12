# Exportar reporte PDF desde los dashboards — Design

**Fecha:** 2026-06-12
**Estado:** Aprobado para implementación

## Objetivo

Botón "Exportar reporte" en los dashboards de Marketing y Ventas que genera un
PDF con marca Lezgo (mismo pipeline `lib/pdf/` que usa el tool `create_pdf` del
asistente IA) conteniendo:

1. Los KPIs y gráficos del dashboard con sus datos actuales (ya filtrados por
   el filtro global de fecha).
2. Una explicación breve y fija de qué muestra cada gráfico.
3. Análisis IA por sección — solo en los gráficos donde aporta valor (decisión
   de diseño, ver tabla abajo) — más un resumen ejecutivo.

## Enfoque

Reutilizar `downloadPdf()` / `PdfSpec` de `lib/pdf/` tal cual (formato
estandarizado en todo el sistema). Lo nuevo es **quién compone el spec**: en el
chat lo compone Claude; aquí lo compone código determinista dentro de cada
dashboard a partir de sus `useMemo` ya calculados, y una llamada IA servidor
agrega los textos de análisis.

Rechazado: recalcular agregaciones en un módulo aparte (duplicaría la lógica de
los dashboards y se desincronizaría) y pedirle a la IA que componga todo el spec
(caro en tokens, no determinista).

## Componentes

### `lib/report.ts` (nuevo, sin React)

- `ReportSection = { id, title, explanation, ai?, blocks: PdfBlock[] }`
- `ReportInput = { reportType: "marketing"|"ventas", title, periodLabel?, kpis, sections }`
- `ReportAiResult = { summary?, analyses?: Record<id, string> }`
- `buildReportSpec(input, ai): PdfSpec` — portada (accent = periodo), bloque
  KPIs, "Resumen ejecutivo (IA)" si hay summary, y por sección:
  heading + texto explicativo + bloques + callout `info` con el análisis IA si
  existe. Si la IA falló, un callout `warn` único al inicio.
- `compactSectionData(section)` — reduce los bloques a datos planos (series de
  charts, tablas truncadas a 15 filas) para el payload IA.

### `app/api/analyze-report/route.ts` (nuevo)

Mismo patrón que `analyze-contact`: `new Anthropic()`, `claude-haiku-4-5`,
system prompt cacheado. Recibe `{ reportType, periodLabel, kpis, sections:
[{id,title,data}] }` (solo las secciones con `ai: true`). Devuelve
`{ summary, analyses }`. El prompt exige responder SOLO JSON
(`{"summary": "...", "sections": [{"id","analysis"}]}`), español, accionable,
sin mencionar GoHighLevel/GHL, sin inventar datos. El parseo tolera fences.
Errores → 500; el cliente exporta el PDF sin análisis (con callout de aviso).

### `components/dashboard/export-report-button.tsx` (nuevo)

Botón `outline` con icono y estados: idle → "Exportar reporte";
generando → spinner "Generando reporte…"; error → texto breve inline (no hay
Toaster montado en el layout). Recibe `getInput: () => ReportInput`. Flujo:
`getInput()` → POST `/api/analyze-report` (try/catch) → `buildReportSpec` →
`downloadPdf`.

### Dashboards (modificados)

Cada uno agrega un `buildReport(): ReportInput` (useCallback sobre sus memos
existentes — respeta los toggles activos del usuario: groupBy, topN, etc.) y
renderiza el botón en una fila al inicio del `DashboardShell`. Nueva prop
opcional `periodLabel?: string` en ambos; `page.tsx` la calcula del
`dateFilter` global ("Últimos 30 días", "1 jun – 10 jun 2026", "Todo el
historial").

## Secciones y análisis IA (decisión)

**Marketing** — IA en: Oportunidades por fuente, Pautas creadas por mes y
reingresos, Oportunidades perdidas por razón, Rendimiento por origen,
Oportunidades ganadas por fuente. Solo explicación en: Pautas por canal,
Oportunidades de pauta por etapa, Por ID de anuncio, Por URL FB/IG, Citas por
pauta, Ganadas por pauta. Criterio: la IA analiza donde hay tendencia,
conversión o causa de pérdida accionable; los desgloses puramente descriptivos
(IDs, URLs) no la necesitan.

**Ventas** — IA en: Recorrido del lead (funnel), Histórico de leads y
conversión a cita, Origen de leads y conversión, Principales razones de
pérdida. Solo explicación en: Estado del embudo por etapa, Resultado de las
citas.

Los gráficos se traducen a bloques `chart` (bar simple/apilada/h, pie, line) o
`table` del spec PDF según legibilidad en papel; las matrices anchas se
aplanan a tablas de Etapa × Total.

## Manejo de errores

- IA no disponible / timeout / JSON inválido → PDF se genera igual, con
  callout `warn` "Análisis IA no disponible".
- `downloadPdf` ya devuelve `{ success, error }`; el botón muestra el error
  inline y vuelve a idle.

## Pruebas

Sin tests automatizados (CLAUDE.md). Verificación: `npx tsc --noEmit`,
`npm run build`, y export real desde ambos tabs en la app corriendo.
