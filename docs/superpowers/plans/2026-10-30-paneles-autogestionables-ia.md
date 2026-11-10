# Paneles autogestionables por IA (Fases 0 y 1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un cliente con el interruptor `ai_panel` encendido entra, ve un panel vacío con "¿Qué quieres ver?", la IA le arma gráficas que se guardan en Neon como consultas declarativas, las edita hablando y organiza pestañas, con deshacer. Hay filtros globales extensibles, filtros por gráfica (fechas y cualquier campo) y filtros entre objetos ("contactos con negocio perdido"). Ante un concepto de negocio ambiguo ("perdidos", "clientes activos"…), la IA razona con evidencia de los datos de la cuenta, pregunta solo cuando hay lecturas materialmente distintas y recuerda la respuesta en un glosario del cliente.

**Architecture:** Un motor puro (`lib/widgets/engine.ts`) ejecuta un `QuerySpec` validado sobre el dataset que el navegador ya tiene, reutilizando las funciones de dominio (`isWonOpp`, `isDePauta`, `adsWindow`, filtros de pipeline). El panel es un documento JSON por cliente (`dashboard_doc`) con escritura condicional por versión e historial. La IA agrega ~10 herramientas al agent loop que ya corre en el navegador, en un modo `panel` de `/api/chat`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.7, Recharts 2.15, zod 3, Neon (`@neondatabase/serverless`), `@anthropic-ai/sdk` 0.98, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-29-paneles-autogestionables-ia-design.md`. Quien ejecute lee **ambos**. Las secciones citadas como §N son del spec.

**Decisiones por defecto** (las preguntas de §17 quedaron sin respuesta; se usan las recomendaciones del spec):
- El panel es por cliente y lo edita cualquiera que entre.
- Sin tope de gasto de IA: se mide con el `totalCost` existente.
- Mismo modelo de IA (`claude-sonnet-5`).
- Con el interruptor encendido, Marketing y Ventas siguen visibles como pestañas fijas.
- El corpus de la evaluación lo redacta quien construya y lo aprueba el dueño.

## Global Constraints

- Trabajar en la rama `feat/panel-ia`, nunca en `main`.
- Gestor de paquetes: **pnpm**. Nunca `npm install`. Si se agrega un paquete, `pnpm add` + commitear `pnpm-lock.yaml`.
- `npx tsc --noEmit` debe quedar limpio en cada tarea (`next build` ignora errores de TS).
- Sin framework de pruebas. Las pruebas son scripts `scripts/verify-*.ts` con `node:assert/strict`, ejecutados con `tsx` y envueltos en `main().catch(...)`: el paquete es CJS y el `await` de nivel superior falla.
- El tenant sale **solo** de `requireClient()`. Ningún `client_id` viene del body.
- Todo el texto visible está en español. Nunca "GoHighLevel" ni "GHL" en la UI: se dice "Lezgo Suite CRM".
- Diseño (DESIGN.md / CLAUDE.md):
  - ámbar `#F59B1B` solo para la serie principal;
  - `CHART_PALETTE` en orden fijo;
  - sin doble eje;
  - `NonZeroTooltipContent`;
  - todo gráfico con drill-down;
  - sin scroll anidado dentro de tarjetas;
  - `tabular-nums` en cifras.
- Las reglas numeradas de `ASSISTANT_SYSTEM_PROMPT` **no se recortan** (son correcciones de regresiones).
- Modelo de `/api/chat`: se queda `claude-sonnet-5` con `thinking: { type: "adaptive" }`. Si cambia, cambia también `PRICING` en `hooks/use-agent-loop.ts`.
- Límites (`DOC_LIMITS`): `maxTabs: 12`, `maxWidgetsPerTab: 24`, `maxDocBytes: 262144`, `maxTitle: 80`, `maxMetrics: 3`, `maxGroupBy: 2`, `maxLimit: 50`, `maxSeries: 6`, `maxBuckets: 366`, `maxVersions: 50`, `maxControls: 8`, `maxRelatedFilters: 4`, `maxConditions: 5` (cláusulas por lista), `maxAnyOf: 5` (condiciones por cláusula), `maxGlossary: 50`.
- **No hay reglas fijas por palabra.** Qué significa "perdido", "activo", "calificado"… lo razona la IA con `resolve_term` y lo guarda el glosario (§6.7). El código solo traduce los enums de GHL a español (`lost` = "perdida", `showed` = "asistió"…).
- Valores que no cambian:
  - Texto de grupo vacío: `"(sin valor)"`; tags vacíos: `"(sin tag)"`.
  - Grupo sin oportunidad en una unión: `"Sin oportunidad"`.
  - Grupo plegado: `"Otros"`.
  - Las tasas salen del motor como fracción 0–1 y la UI las formatea como %.
- La DDL va en `scripts/db-migrate.ts`, idempotente, por `DATABASE_URL_UNPOOLED`. Antes de algo destructivo, verificar que el endpoint sea `ep-frosty-term-awf7asfw`.
- `dashboard_doc` **no es desechable** (a diferencia de `project_sync`). Nunca se borra en UNINSTALL.

## Review Focus

1. **Un campo personalizado que se renombró o borró en GHL después de guardar el widget**: la tarjeta debe decir "No se pudo calcular: el campo X ya no existe. Pídele a la IA que la ajuste", nunca mostrar 0 ni quedar en blanco. Prueba en la Tarea 5 (`QueryError` `unknown_field`) y verificación en la Tarea 17.
2. **Payload cacheado viejo sin `ads`, o Meta desconectado**: los widgets de Meta muestran el aviso de pendiente o de desconectado, nunca ceros. Prueba en la Tarea 7.
3. **Un valor predeterminado guardado que ya no existe en los datos** (el asesor "Ana" se fue): su chip se marca "(sin datos)" y los widgets afectados dicen "Sin datos para este filtro", en vez de vaciar el panel sin explicación (§12, invariante 13). Prueba en la Tarea 18B.
4. **Dos sesiones editando a la vez**: la escritura vieja recibe 409, el cliente recarga y la IA recibe "el panel cambió; vuelve a leerlo". Prueba en la Tarea 14 (store) y en la Tarea 20 (executor).
5. **La IA referencia un widget o pestaña que el usuario borró a mitad de la conversación**: `tool_result` con `is_error` y un mensaje claro, sin excepción no atrapada. Pruebas en las Tareas 13 y 20.

---

## Mapa de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `lib/widgets/spec.ts` | Tipos, constantes, zod, JSON Schema estricto, `parseDoc`, `emptyDoc` | 1 |
| `lib/source-platform.ts` (mod.) | + `sourceCategory` y sus constantes, movidos desde Marketing | 2 |
| `lib/pauta.ts` (mod.) | + `rankPautasByContact` (ranking de reingresos) | 2 |
| `lib/appointment-status.ts` | `APPT_STATUS_ORDER` compartido | 2 |
| `lib/widgets/semantic.ts` | Catálogo: campos por fuente, accesores, dimensiones derivadas y relacionadas, operadores de filtro | 3 |
| `lib/widgets/metrics.ts` | Registro de métricas (`compute(rows, ctx)`) y compatibilidad métrica↔fuente | 4 |
| `lib/widgets/engine.ts` | `runQuery`, `groupAndMeasure`, buckets, plegado, unión, comparación | 5, 6, 8 |
| `lib/widgets/ads-metrics.ts` | Fuente `ads_daily` y métricas de Meta sobre `lib/ads.ts` | 7 |
| `lib/widgets/validate.ts` | `buildCatalog`, `validateWidget` con sugerencias | 9 |
| `lib/widgets/describe.ts` | `describeWidget`, `buildPanelSnapshot`, `buildPanelCatalogSummary` | 10 |
| `lib/widgets/terms.ts` | `resolveTerm`: dónde aparece un concepto en los datos, con traslape | 10B |
| `lib/ai-tools.ts`, `lib/ai-context.ts` (mod.) | `aggregate`/`relate` sobre el motor, "ganada" con `isWonOpp`, ejemplo L264 | 11 |
| `scripts/check-widget-parity.ts` | Compuerta de la fase 0 contra cuentas reales cacheadas | 12 |
| `lib/widgets/doc-ops.ts` | Operaciones puras sobre el doc | 13 |
| `lib/dashboard-store.ts`, `scripts/db-migrate.ts`, `lib/installations.ts`, `lib/clients.ts` (mod.) | Persistencia, versiones, interruptor `ai_panel` | 14 |
| `app/api/dashboards/route.ts`, `app/api/dashboards/restore/route.ts` | API | 15 |
| `hooks/use-dashboard-doc.ts` | Estado del doc en el cliente, commit, deshacer | 16 |
| `components/widgets/*` | `WidgetCard` y una vista por `viz` | 17 |
| `components/widgets/widget-grid.tsx`, `panel-tabs.tsx`, `app/page.tsx` (mod.) | Cuadrícula, pestañas e integración | 18 |
| `lib/widgets/filter-state.ts`, `hooks/use-panel-filters.ts`, `components/widgets/panel-filter-bar.tsx`, `filter-field-picker.tsx`, `widget-filter-editor.tsx` | Filtros globales, por gráfica y entre objetos (UI y estado de sesión) | 18B |
| `lib/widgets/suggestions.ts`, `components/widgets/empty-panel.tsx` | Panel vacío | 19 |
| `lib/widgets/tools.ts`, `lib/chat-request.ts`, `app/api/chat/route.ts`, `hooks/use-agent-loop.ts`, `lib/ai-context.ts` (mod.) | Herramientas del panel y modo `panel` | 20 |
| `components/widgets/copilot-dock.tsx` | Copiloto lateral | 21 |
| `scripts/eval-panel/*` | Corpus y runner de la evaluación | 22 |
| `CLAUDE.md` (mod.) | Documentación | 23 |
| `scripts/verify-widgets.ts`, `scripts/verify-dashboard-store.ts` | Pruebas | 1–14 |

---

# FASE 0 — El motor

### Task 1: Spec del widget (tipos, zod, JSON Schema estricto)

**Files:**
- Create: `lib/widgets/spec.ts`
- Create: `scripts/verify-widgets.ts`
- Modify: `package.json` (script `"verify:widgets": "tsx scripts/verify-widgets.ts"`)

**Interfaces:**
- Produces (todo exportado desde `lib/widgets/spec.ts`):
  - `VIZ_TYPES = ["kpi","bar","bar_horizontal","stacked_bar","grouped_bar","line","area","funnel","table","record_list","text"] as const`, `type VizType`
  - `SOURCES = ["contacts","opportunities","appointments","tasks","pautas","ads_daily"] as const`, `type SourceId`
  - `METRIC_IDS = ["count","contacts","value_sum","value_avg","won_count","won_value","win_rate","appointment_rate","show_rate","overdue_tasks","leads_contacts","leads_pauta_opps","leads_pauta_unique","spend","impressions","clicks","ctr","cpc","cpm","cpl"] as const`, `type MetricId`. `cost_per_appointment` y `roas` quedan **fuera** hasta que el dueño defina sus denominadores.
  - `FILTER_OPS = ["eq","neq","in","not_in","contains","is_empty","is_not_empty","gt","gte","lt","lte"] as const`, `type FilterOp`
  - `RANGE_PRESETS = ["today","last_7d","last_30d","last_90d","this_week","this_month","last_month","this_quarter","ytd","next_7d","next_30d","all"] as const`, `type RangePreset`
  - `BUCKETS = ["day","week","month","quarter","weekday","hour"] as const`, `type Bucket`
  - Las interfaces `WidgetSpec`, `QuerySpec`, `GroupBySpec { dimension; bucket: Bucket|null; join: "latest"|"each"|null }`, `FilterSpec { field; op; values: string[] }`, `RelatedFilterSpec { entity: EntityId; quantifier: "any"|"none"; conditions: FilterSpec[] }`, `TimeSpec`, `Widget`, `Tab`, `DashboardDoc`, `PanelFilters`, `FilterControl` (con `kind: "field" | "condition"`), `FilterClause { anyOf: FilterSpec[] }`, `GlossaryEntry` exactamente como en §6.2 (`size: "s"|"m"|"l"|"xl"`, `height: "compact"|"normal"|"tall"`). `QuerySpec` lleva `relatedFilters` y `globalFilters: "inherit"|"ignore"`; **no** existe `pipelineScope`. `filters` y `RelatedFilterSpec.conditions` son `FilterClause[]`.
  - `ENTITIES = ["contact","opportunity","appointment","task","pauta"] as const`, `type EntityId`, y `SOURCE_ENTITY: Record<Exclude<SourceId,"ads_daily">, EntityId>` (`contacts` → `contact`, etc.)
  - `DOC_LIMITS` (valores en Global Constraints)
  - `widgetSpecSchema: z.ZodType<WidgetSpec>`, `dashboardDocSchema: z.ZodType<DashboardDoc>`
  - `WIDGET_SPEC_JSON_SCHEMA: Record<string, unknown>`: escrito a mano y compatible con `strict` (§8.3): `additionalProperties: false` en cada objeto, todos los campos en `required`, `null` para "no aplica", sin `minimum`/`maxLength`, sin recursión
  - `emptyDoc(): DashboardDoc` → `{ schemaVersion: 1, tabs: [], filters: { defaultDate: null, defaultPipelines: [], controls: [] }, glossary: [] }`
  - `parseDoc(raw: unknown): DashboardDoc`: valida con zod; un doc sin `schemaVersion` o con una versión desconocida lanza `Error`

- [ ] **Step 1: Write the failing tests** en `scripts/verify-widgets.ts`, con `section("spec")` y una estructura `main()` que crecerá en las tareas siguientes:
  - `widgetSpecSchema.parse(validSpec)` acepta un spec de ejemplo (citas por `opportunity.stage`, join `latest`).
  - Rechaza `query.metrics` con 0 y con 4 elementos, `groupBy` con 3, `limit: 51`, `title` de 81 caracteres, `relatedFilters` con 5 elementos, un `conditions` con 6 y `doc.filters.controls` con 9.
  - Acepta un spec de "contactos con negocio perdido, por estado o por etapa": `source: "contacts"`, `relatedFilters: [{ entity: "opportunity", quantifier: "any", conditions: [{ anyOf: [{ field: "status", op: "eq", values: ["lost"] }, { field: "stage", op: "in", values: ["Negocio Perdido"] }] }] }]`.
  - Rechaza una cláusula con `anyOf: []` y con 6 condiciones; rechaza un control `kind: "field"` con `field: null` y uno `kind: "condition"` con `clause: null`.
  - `viz: "text"` exige `query: null` y `text` no nulo; cualquier otro `viz` exige `query` no nulo.
  - Prueba de deriva: un recorrido recursivo de `WIDGET_SPEC_JSON_SCHEMA` comprueba que cada `type: "object"` tiene `additionalProperties === false` y que `required` contiene **todas** las claves de `properties`.
  - El conjunto de claves de nivel superior de `WIDGET_SPEC_JSON_SCHEMA.properties` es igual al de `widgetSpecSchema.shape`.
  - `parseDoc(emptyDoc())` hace el viaje de ida y vuelta; `parseDoc({ tabs: [] })` lanza.

- [ ] **Step 2: Run** `pnpm verify:widgets`. Expected: FAIL (el módulo no existe).
- [ ] **Step 3: Implement** `lib/widgets/spec.ts` con las exportaciones de arriba. Los rangos numéricos y de longitud van en zod con `.min/.max`, no en el JSON Schema.
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS y sin errores.
- [ ] **Step 5: Commit** `feat(widgets): spec del widget con zod y JSON Schema estricto`.

### Task 2: Extraer las funciones de dominio que hoy viven dentro de los tableros

Se mueven sin cambiar comportamiento, para que el motor y los tableros compartan una sola implementación (§12, invariante 4).

**Files:**
- Modify: `lib/source-platform.ts`. Recibe `sourceCategory`, `isCrmUi`, `CRM_UI_VALUES`, `SOURCE_CATEGORY_ORDER`, `SOURCE_CATEGORY_COLORS`, `SOURCE_CATEGORY_LABELS` y `catLabel` desde `components/dashboard/marketing-dashboard.tsx:228-286`.
- Modify: `components/dashboard/marketing-dashboard.tsx`. Importa las funciones movidas y cambia `pautaReingresoMap` (~L565-579) para usar `rankPautasByContact`.
- Modify: `lib/pauta.ts`
- Create: `lib/appointment-status.ts`. Exporta `APPT_STATUS_ORDER = ["showed","confirmed","new","noshow","cancelled","invalid"]`, que se mueve desde `components/dashboard/sales-dashboard.tsx:119`.
- Modify: `components/dashboard/sales-dashboard.tsx` (importa `APPT_STATUS_ORDER`).

**Interfaces:**
- Produces:
  - `sourceCategory(opp: Opportunity): string` y `catLabel(cat: string): string` desde `lib/source-platform.ts`
  - `rankPautasByContact(allPautas: Pauta[]): Map<string, number>`: pautaId → índice 0-based dentro del historial de su contacto, ordenado por `createdAt` (con la misma normalización `toUTCDateStr` que usa hoy Marketing). Las pautas sin `contactId` no entran al mapa (= rango 0, primer ingreso).
  - `APPT_STATUS_ORDER` desde `lib/appointment-status.ts`

- [ ] **Step 1: Write the failing tests** en `scripts/verify-widgets.ts`, `section("domain")`:
  - `sourceCategory` devuelve `"Paid Social"` para `source: "facebook"`, `"CRM UI"` para `source: ""` y `"Paid Search"` cuando el custom field "Tipo de pauta" es "Google Ads".
  - `rankPautasByContact`: con 3 pautas del contacto c1 en fechas desordenadas → rangos 0, 1, 2 en orden cronológico; una pauta sin `contactId` no está en el mapa.
- [ ] **Step 2: Run** `pnpm verify:widgets`. Expected: FAIL.
- [ ] **Step 3: Move** el código. Marketing y Ventas importan las funciones; no queda ninguna copia local.
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Verify in the real app.** `pnpm dev`, entra con una cuenta con datos y confirma que "Oportunidades por fuente", el KPI "Leads únicos" y "Resultado de las citas" muestran los mismos números que en `main`, con el mismo filtro.
- [ ] **Step 6: Commit** `refactor: comparte sourceCategory, ranking de reingresos y orden de estados de cita`.

### Task 3: Capa semántica (campos, accesores, dimensiones, filtros)

**Files:**
- Create: `lib/widgets/semantic.ts`
- Test: `scripts/verify-widgets.ts`, `section("semantic")`

**Interfaces:**
- Consumes: los tipos de la Tarea 1; `getChatIndex`/`ChatIndex` (`lib/ai-index.ts`); `isDePauta`, `resolveCampaignName` (`lib/pauta.ts`); `isWonOpp`; `sourceCategory`, `platformLabel`.
- Produces:
  - `interface ActiveGlobalFilter { entity: EntityId; label: string; clause: FilterClause }`: un control global activo. Un control `field` con valores se convierte en `{ anyOf: [{ field, op: "in", values }] }` y una `condition` encendida aporta su `clause`. Los controles en "todos" o apagados no se pasan.
  - `interface EngineContext { dataset: ChatDataset; pipelines: Pipeline[]; ads: AdsReport | undefined; dateRange: ResolvedDateRange | null; pipelineFilter: PipelineFilter; globalFilters: ActiveGlobalFilter[]; now: Date }`
  - `interface ResolvedCtx extends EngineContext { index: ChatIndex; pautaContactsAll: Set<string>; pautaRank: Map<string, number> }` y `resolveCtx(ctx: EngineContext): ResolvedCtx`, memoizado por la referencia de `dataset.contacts` igual que `getChatIndex`
  - `SOURCE_DEFS: Record<SourceId, { dateFields: string[]; primaryDate: string; contactIdOf(row): string | undefined; rows(ctx): Record<string, unknown>[] }>`. Fechas válidas:
    - contacts: `createdAt`
    - opportunities: `createdAt` | `closedAt` | `updatedAt`
    - appointments: `startTime`
    - tasks: `dueDate` | `createdAt`
    - pautas: `createdAt`
    - ads_daily: `date`
  - `NATIVE_FIELDS: Record<SourceId, string[]>`: los mismos campos que hoy listan `list_fields` y la descripción de `aggregate.groupBy` (`lib/ai-tools.ts:1150-1186`, `:304`)
  - `DERIVED_FIELDS.opportunities = ["dePauta","campaignResolved","won","funnelState","sourceCategory","platform"]`. Los booleanos derivados (`dePauta`, `won`) valen `"true"` / `"false"` como texto.
  - `dimensionValues(source: SourceId, row: Record<string, unknown>, field: string, ctx: ResolvedCtx): string[]`. Siempre devuelve ≥1 valor. Despliega tags (vacío → `"(sin tag)"`) y `cf:` multiopción (vacío → `"(sin valor)"`). Los valores con `" - http"` se recortan igual que hoy en `aggregateRows` (`campaignTitle`).
  - `funnelState(opp: Opportunity): string`: la regla de `sales-dashboard.tsx:425-465`. Ganada por `isWonOpp` → `"Ganado"`; `status === "abandoned"` → `"Abandonado"`; `"lost"` → `"Perdido"`; si no, la etapa cruda.
  - `matchesFilter(source, row, f: FilterSpec, ctx: ResolvedCtx): boolean`. Comparación de texto sin distinguir mayúsculas. `in` = cualquiera de `values`. `is_empty` acepta `"(sin valor)"`. `gt`/`lt` comparan como número, o como fecha ISO si el campo es de fecha.
  - `matchesClause(source, row, c: FilterClause, ctx): boolean` (alguna condición de `anyOf` se cumple) y `matchesAll(source, row, clauses: FilterClause[], ctx): boolean` (todas las cláusulas se cumplen)
  - `clauseFields(c: FilterClause): string[]`: los campos que toca una cláusula (para la precedencia de la Tarea 5)
  - `isRelatedDimension(d: string): boolean`, para `contact.*` y `opportunity.*`
  - `class QueryError extends Error { constructor(public code: "unknown_field" | "unsupported" | "invalid", message: string) }`
  - `knownCustomFields(source, ctx): Set<string>`: unión de las claves de `customFieldsResolved` en los registros de esa fuente
  - `ENTITY_FIELDS: Record<EntityId, { field: string; label: string }[]>`: los campos filtrables por objeto, con etiqueta en español para la UI y el ScopePill.
    - opportunity: Pipeline, Etapa, Estado, Ganada, Asesor, Fuente, Plataforma, De pauta, Motivo de pérdida;
    - contact: Fuente, Plataforma, Tags, Asesor, Ciudad;
    - appointment: Estado, Asesor;
    - task: Estado, Asesor;
    - pauta: Tipo, Campaña.
    - Además, los `cf:` de contacto y oportunidad, que se agregan dinámicamente.
  - `listFieldValues(entity: EntityId, field: string, ctx: ResolvedCtx): { value: string; count: number }[]`: valores distintos con conteo sobre **todos** los registros, ordenados por conteo. Lo usan el selector de filtros y la IA.
  - `contactsMatchingRelated(rf: RelatedFilterSpec, ctx: ResolvedCtx): Set<string>`: contactos con al menos un registro de `rf.entity` que cumple **todas** las cláusulas de `conditions` **en el mismo registro**, evaluado sobre el conjunto completo (sin filtro de fecha). Con `entity: "contact"`, contactos que cumplen las condiciones. Se memoiza por `JSON.stringify(rf)` + la referencia del dataset.
  - `matchesRelated(source: SourceId, row, rf: RelatedFilterSpec, ctx: ResolvedCtx): boolean`: `contactIdOf(row)` en el conjunto anterior (`any`) o fuera de él (`none`). Una fila sin contacto → `false` en ambos casos.

- [ ] **Step 1: Write the failing tests** con un fixture compartido `makeFixture()` en `scripts/verify-widgets.ts`, reutilizado por las Tareas 4–8:
  - **contacts** c1, c2, c3, c4. c1 tiene `cf "Origen de Lead": ["Facebook","Instagram"]`, tags `["vip"]`.
  - **opps**:
    - o1: c1, pipeline p1, "Primera Cita", open, `createdAt` 2026-09-01.
    - o2: c1, p2, "Propuesta", open, 2026-10-01.
    - o3: c2, p1, "Negocio Ganado", status `open`, value 1000, 2026-10-05, `closedAt` 2026-10-06.
    - o4: c3, p1, lost, `lostReason` "Precio", 2026-10-10.
  - **appointments**:
    - a1: c1, 2026-10-20, showed.
    - a2: c1, 2026-10-21, noshow.
    - a3: c1, 2026-10-22, showed.
    - a4: c4, 2026-10-23, confirmed.
  - **pautas**: p-a (c1, 2026-09-01), p-b (c1, 2026-10-02), p-c (sin contacto, 2026-10-03).
  - **pipelines**: p1 con etapas `["Primera Cita","Negocio Ganado"]` y p2 con `["Propuesta"]`.
  - **now** = `2026-10-29T12:00:00` local.

  Aserciones:
  - `dimensionValues("contacts", c1, "cf:Origen de Lead")` → `["Facebook","Instagram"]`.
  - `dimensionValues("contacts", c2, "tags")` → `["(sin tag)"]`.
  - `funnelState(o3)` → `"Ganado"` y `funnelState(o4)` → `"Perdido"`.
  - `matchesFilter` con `{ field: "cf:Origen de Lead", op: "in", values: ["instagram"] }` sobre c1 → `true`.
  - `{ op: "is_empty", field: "cf:Origen de Lead" }` sobre c2 → `true`.
  - `knownCustomFields("contacts")` contiene "Origen de Lead".
  - `listFieldValues("opportunity", "stage")` → incluye `{ value: "Propuesta", count: 1 }`.
  - `dimensionValues("opportunities", o3, "won")` → `["true"]` (ganada por etapa) y `dimensionValues("opportunities", o1, "won")` → `["false"]`.
  - `matchesClause` con `{ anyOf: [{ field: "status", op: "eq", values: ["lost"] }, { field: "stage", op: "in", values: ["Propuesta"] }] }` → `true` para o4 (estado) y o2 (etapa), `false` para o1.
- [ ] **Step 2: Run** `pnpm verify:widgets`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/widgets/semantic.ts`.
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(widgets): capa semántica con dimensiones derivadas, filtros planos y entre objetos`.

### Task 4: Registro de métricas

**Files:**
- Create: `lib/widgets/metrics.ts`
- Test: `scripts/verify-widgets.ts`, `section("metrics")`

**Interfaces:**
- Consumes: `ResolvedCtx`, `SOURCE_DEFS` (Tarea 3).
- Produces:
  - `interface MetricDef { id: MetricId; label: string; sources: SourceId[]; kind: "count" | "amount" | "rate"; compute(rows: Record<string, unknown>[], ctx: MetricCtx): number | null }`
  - `interface MetricCtx extends ResolvedCtx { range: ResolvedDateRange | null; source: SourceId }`
  - `METRICS: Record<MetricId, MetricDef>`
  - `metricAllowed(metric: MetricId, source: SourceId): boolean`

  Definiciones fijas: son las de §6.3 y "won" siempre es `isWonOpp`. Las razones son `null` cuando el denominador es 0.
  - `win_rate` = ganadas / filas.
  - `appointment_rate` (opportunities) = filas cuyo `contactId` tiene una cita con `startTime` dentro de `ctx.range` y que pasa los filtros globales activos (hoy, eso es el pipeline) ÷ filas. Es la paridad con `sales-dashboard.tsx:340-357`.
  - `show_rate` (appointments) = `status === "showed"` ÷ filas.
  - `overdue_tasks` = `status === "pending"` con `dueDate` < `ctx.now`.
  - `leads_pauta_opps` (opportunities) = filas con `isDePauta(o, ctx.pautaContactsAll)`.
  - `leads_pauta_unique` (pautas) = filas con `(ctx.pautaRank.get(id) ?? 0) === 0`.
  - `contacts` = `contactId` distintos.
  - Las métricas de Meta se registran en la Tarea 7.

- [ ] **Step 1: Write the failing tests** con el fixture de la Tarea 3:
  - `won_count` sobre todas las opps → 1 (o3, ganada por etapa).
  - `win_rate` → 0.25 y `won_value` → 1000.
  - `show_rate` sobre las 4 citas → 0.5.
  - `leads_pauta_unique` sobre las 3 pautas → 2 (p-a y p-c).
  - `leads_pauta_opps` → 2 (o1 y o2, porque c1 tiene pautas).
  - `appointment_rate` sobre las 4 opps con `range` = octubre → 0.5 (o1 y o2 tienen citas de c1).
  - `metricAllowed("show_rate","opportunities")` → `false`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(widgets): registro de métricas con definiciones de paridad`.

### Task 5: Motor — pipeline de consulta, tiempo, agrupación y plegado

**Files:**
- Create: `lib/widgets/engine.ts`
- Test: `scripts/verify-widgets.ts`, `section("engine")`

**Interfaces:**
- Consumes: las Tareas 1, 3 y 4; `filterByDateRange` (`lib/date-range.ts`); `contactIdsInPipelines`, `filterOpportunitiesByPipelines`, `filterByContactIds` (`lib/pipeline-filter.ts`).
- Produces:
  - `interface QueryRow { key: string[]; label: string[]; values: (number | null)[]; records: Record<string, unknown>[] }`
  - `interface QueryResult { rows: QueryRow[]; totals: (number | null)[]; compare: { totals: (number | null)[]; range: { from: string; to: string } } | null; meta: QueryMeta }`
  - `interface QueryMeta { source: SourceId; recordCount: number; range: { from: string; to: string } | null; bucketUsed: Bucket | null; foldedIntoOtros: number; seriesFolded: number; fanOut: boolean; crmFiltersIgnored: boolean; overriddenGlobals: string[]; warnings: string[]; adsStatus: AdsStatus | "pending" | null; adsMessage: string | null }`
  - `resolveWidgetRange(time: TimeSpec, ctx: EngineContext): ResolvedDateRange | null`. `"inherit"` → `ctx.dateRange`; los presets se calculan sobre `ctx.now` con `date-fns` en hora local, como `resolveDateRange`; `"all"` → `null`.
  - `runQuery(q: QuerySpec, ctx: EngineContext): QueryResult`. Lanza `QueryError`.
  - `groupAndMeasure(records, source, groupBy: GroupBySpec[], metrics: MetricId[], ctx: MetricCtx, opts: { sort: QuerySpec["sort"]; limit: number | null; fold: boolean }): { rows: QueryRow[]; foldedIntoOtros: number; seriesFolded: number; fanOut: boolean }`, para la Tarea 11.
  - `passesGlobalOpportunityFilters(opp: Opportunity, q: QuerySpec, ctx: ResolvedCtx): boolean`: el pipeline y los `ctx.globalFilters` con `entity: "opportunity"` evaluados sobre una oportunidad, respetando la precedencia. Lo usa la Tarea 6.

  Orden del pipeline de `runQuery`:
  1. filas de la fuente;
  2. `filters` propios;
  3. `relatedFilters`;
  4. rango;
  5. filtros globales (pipeline + `ctx.globalFilters`), si `globalFilters === "inherit"`;
  6. agrupación;
  7. métricas;
  8. orden;
  9. plegado.

  Reglas que la firma no determina:
  - **Rango.** Si `time.field` es la fecha primaria de la fuente, las filas sin fecha **se conservan** (paridad con `filterByDateRange`). Si es una fecha secundaria (`closedAt`, `updatedAt`, `dueDate`), las filas sin fecha **se descartan** (paridad con `closedAfter` de `applyOppFilters`).
  - **Filtros globales** (`globalFilters: "inherit"`, §6.6).
    - El pipeline se aplica como hoy: las oportunidades pasan por `filterOpportunitiesByPipelines`; el resto, por `filterByContactIds(rows, contactIdOf, contactIdsInPipelines(dataset.opportunities, filter))`, derivado de **todas** las oportunidades.
    - Cada `ActiveGlobalFilter` cuyo `entity` es `SOURCE_ENTITY[source]` se aplica como cláusula propia. Si es de otro objeto, se aplica como `RelatedFilterSpec { entity, quantifier: "any", conditions: [clause] }`.
    - **Precedencia**: un global se omite si **todos** los campos de su cláusula (`clauseFields`) ya están filtrados por el widget sobre el mismo objeto (en `q.filters` o en un `q.relatedFilters` de ese objeto; para el pipeline, `pipelineId`/`pipelineName`). Su `label` se agrega a `meta.overriddenGlobals`.
    - La fuente `ads_daily` no aplica ninguno y marca `meta.crmFiltersIgnored = true` (Tarea 7).
  - **Buckets.**
    - `week` = lunes ISO `YYYY-MM-DD`; `month` = `YYYY-MM`; `quarter` = `YYYY-Qn`.
    - `weekday`: claves `"1".."7"` con etiquetas `lun..dom`. `hour`: claves `"00".."23"`.
    - Con rango, se rellenan los huecos entre `from` y `to` (o entre el mínimo y el máximo observados si el rango es `null`). Las métricas de conteo y monto rellenan 0; las de razón, `null`.
    - Si un bucket `day`/`week`/`month` produce más de `DOC_LIMITS.maxBuckets`, se sube un nivel hasta que quepa, con `bucketUsed` y una advertencia en español.
  - **Orden.** `natural`: buckets cronológicos; `stage`/`funnelState` en el orden de las etapas de `ctx.pipelines` (desconocidas al final, alfabéticas; "Ganado", "Abandonado", "Perdido" al final); `status` de citas según `APPT_STATUS_ORDER`.
  - **Plegado.** Con `limit`, se quedan los N primeros grupos de la primera dimensión. El resto se junta en `"Otros"`, cuyas métricas se **recalculan con `compute` sobre los registros concatenados**, nunca sumando razones. La segunda dimensión se pliega a `maxSeries` (6) igual.
  - **Errores.** Un campo `cf:` que no está en `knownCustomFields` lanza `QueryError("unknown_field", "El campo «X» ya no existe")`. Un campo nativo desconocido también lanza `unknown_field`.
  - **Datos que no existen (§12, invariante 7).** Con la fuente `appointments`, si el rango resuelto empieza antes de `now − 90 días`, termina después de `now + 90 días` o es `null`, se agrega la advertencia "Las citas solo cubren 90 días hacia atrás y 90 hacia adelante; fuera de eso no hay datos." (ventana de `lib/sync.ts:320-321`).

- [ ] **Step 1: Write the failing tests** con el fixture:
  - opps por `funnelState`, `sort natural` → etiquetas `["Primera Cita","Propuesta","Ganado","Perdido"]`.
  - opps por `createdAt` + `month`, `range: "all"` → `{"2026-09":1,"2026-10":3}`.
  - `range: "last_30d"` con `now` 2026-10-29 → `recordCount` 3 (o2, o3, o4).
  - `time.field: "closedAt"` con `last_30d` → solo o3. Con `"all"` → las 4.
  - opps por `stage` con `limit: 2` y `fold` → 3 filas, la última `"Otros"`, `foldedIntoOtros` 2.
  - `win_rate` de `"Otros"` = razón recalculada sobre sus registros.
  - `pipelineFilter ["p2"]` sobre citas por `status` → solo citas de c1 (a1, a2, a3).
  - **Filtros entre objetos**, con un fixture aparte `makeLostFixture()`:
    - contactos k1..k4;
    - opps: q1 (k1, pipeline A, status lost), q2 (k1, pipeline B, open, "Propuesta"), q3 (k2, A, open, "Negocio Perdido"), q4 (k3, A, open, "Propuesta");
    - k4 sin oportunidades.
  - "Contactos con negocio perdido" con cada lectura posible, expresada como cláusulas (el motor no sabe qué significa "perdido"):
    - `[{anyOf:[status eq lost]}]` → `{k1}`;
    - `[{anyOf:[stage in ["Negocio Perdido"]]}]` → `{k2}`;
    - `[{anyOf:[status eq lost, stage in ["Negocio Perdido"]]}]` → `{k1, k2}`.
  - `quantifier: "none"` con la cláusula OR anterior → `{k3, k4}`.
  - **Mismo registro**: `any` con `[{anyOf:[status eq lost]}, {anyOf:[pipelineName eq B]}]` → `{}`. k1 tiene una perdida en A y una abierta en B; evaluar las cláusulas por separado lo habría incluido.
  - Global `{ entity: "opportunity", label: "Asesor", clause: { anyOf: [{ field: "assignedTo", op: "in", values: ["Ana"] }] } }` con q3 asignada a Ana, sobre la fuente contacts → solo k2.
  - Con un widget que tiene su propio `filters [{ field: "pipelineName", op: "eq", values: ["B"] }]` sobre opportunities y `pipelineFilter` global = A → el widget muestra q2 y `meta.overriddenGlobals` incluye `"pipeline"`.
  - `globalFilters: "ignore"` → el filtro global de asesor no se aplica.
  - Una fila sin contacto con un `relatedFilters` activo → excluida.
  - **Review Focus 1:** `filters [{ field: "cf:Campo Borrado", op: "in", values: ["x"] }]` → lanza `QueryError` con `code === "unknown_field"`.
  - Bucket demasiado fino: citas sintéticas cada día de 2023-01-01 a 2026-10-29, bucket `day`, rango `all` → `meta.bucketUsed === "week"`, filas ≤366 y `warnings.length === 1`.
  - Línea mensual de `win_rate` con un mes sin opps dentro del rango → el valor de ese mes es `null`, no 0.
  - Citas con `range: absolute 2026-01-01..2026-10-29` → `meta.warnings` contiene "solo cubren 90 días". Con `last_30d` → sin esa advertencia.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `runQuery`, `resolveWidgetRange` y `groupAndMeasure`.
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(widgets): motor de consultas con buckets, alcance de pipeline y plegado`.

### Task 6: Motor — dimensiones relacionadas (unión de búsqueda)

**Files:**
- Modify: `lib/widgets/engine.ts`, `lib/widgets/semantic.ts`
- Test: `scripts/verify-widgets.ts`, `section("join")`

**Interfaces:**
- Produces: la dimensión `opportunity.<campo>` disponible para contacts, appointments, tasks y pautas (`<campo>` ∈ campos nativos, derivados o `cf:` de oportunidades), y `contact.<campo>` para opportunities, appointments, tasks y pautas. `meta.fanOut = true` cuando `join: "each"` desplegó algún registro.

  Algoritmo de `opportunity.*` (§6.4):

  ```ts
  // candidatos: TODAS las oportunidades del contacto (ctx.index.oppsByContact), nunca las filtradas por fecha
  let cands = ctx.index.oppsByContact.get(contactId) ?? []
  if (q.globalFilters === "inherit")   // pipeline + controles globales sobre "opportunity" (respetando la precedencia de la Tarea 5)
    cands = cands.filter((o) => passesGlobalOpportunityFilters(o, q, ctx))
  if (cands.length === 0) return ["Sin oportunidad"]
  if (join === "each") return cands.flatMap((o) => dimensionValues("opportunities", o, field, ctx))
  const latest = cands.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))  // join "latest" (default when null)
  return dimensionValues("opportunities", latest, field, ctx)
  ```

- [ ] **Step 1: Write the failing tests**. Este es el ejemplo del dueño:
  - citas por `opportunity.stage`, join `latest` → `{"Propuesta":3,"Sin oportunidad":1}`; la suma (4) = total de citas.
  - Igual con `pipelineFilter ["p1"]` → `{"Primera Cita":3}`. a4 sale por el alcance de pipeline y la oportunidad más reciente de c1 dentro de p1 es o1.
  - join `each` → `{"Primera Cita":3,"Propuesta":3,"Sin oportunidad":1}` y `meta.fanOut === true`.
  - Con el global `{ entity: "opportunity", field: "stage", values: ["Primera Cita"] }` y sin filtro de pipeline → `{"Primera Cita":3}`: la más reciente de c1 **entre las que pasan el filtro** es o1, y a4 sale por el filtro entre objetos.
  - opps por `contact.cf:Origen de Lead` → o1 y o2 cuentan en "Facebook" y en "Instagram".
  - o3 y o4 → `"(sin valor)"`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(widgets): dimensiones relacionadas con unión latest/each`.

### Task 7: Métricas de Meta (`ads_daily`, CPL)

**Files:**
- Create: `lib/widgets/ads-metrics.ts`
- Modify: `lib/widgets/metrics.ts` (registra las métricas de Meta), `lib/widgets/engine.ts` (fuente `ads_daily`)
- Test: `scripts/verify-widgets.ts`, `section("ads")`

**Interfaces:**
- Consumes: `adsWindow`, `firstRecordedDay`, `daysInWindow`, `sumAdDays`, `costPer` (`lib/ads.ts`).
- Produces:
  - `adsRowsFor(ctx: ResolvedCtx, range: ResolvedDateRange | null): { rows: AdDay[]; window: { from: string; to: string } | null; status: AdsStatus | "pending"; message: string | null }`. `crmFrom = firstRecordedDay(dataset.contacts, dataset.opportunities)`, sobre los conjuntos **sin filtrar**.
  - Métricas `spend`, `impressions`, `clicks`, `ctr`, `cpc`, `cpm`: `sumAdDays(rows)` y nunca promedios de razones.
  - `cpl` = `spend ÷ count(leads_pauta_opps creadas dentro del mismo window)`, con las oportunidades **sin** filtro de pipeline. Es la paridad con `ads-section.tsx:312-376` y `marketing-dashboard.tsx:900-908`.
  - Con bucket de `date`, `cpl` por bucket = gasto del bucket ÷ leads creados en ese bucket.
  - La fuente `ads_daily` no aplica ningún filtro de CRM (pipeline, controles globales, `filters`/`relatedFilters` de CRM) y fuerza `meta.crmFiltersIgnored = true`, sin importar `globalFilters`. El denominador del `cpl` tampoco se filtra.
  - Si `isWindowClipped` (`lib/ads.ts:243`) indica que el window quedó más corto que el rango pedido, se agrega la advertencia "El gasto solo cubre del {from} al {to}; el CPL usa los leads de esos mismos días." (paridad con el aviso de `AdsSection`, CLAUDE.md "The window is CLIPPED").

- [ ] **Step 1: Write the failing tests**:
  - `ads.daily` con gasto 2026-10-01..2026-10-10 de 100 por día; contactos desde 2026-10-05; 2 opps de pauta creadas 2026-10-06 y 2026-10-08.
  - `spend`, `range: "all"` → 600, recortado desde `crmFrom` 2026-10-05.
  - `cpl` → 300.
  - `ctr` = `clicks ÷ impressions` de las sumas.
  - **Review Focus 2:** `ads: undefined` → `rows: []`, `meta.adsStatus === "pending"`. `ads.status: "disconnected"` → `meta.adsStatus === "disconnected"` con su `message`, `totals[0] === null`.
  - Con `pipelineFilter ["p2"]` y un global de asesor, `cpl` no cambia y `meta.crmFiltersIgnored === true`.
  - `spend` con `range: "all"` en el fixture (gasto desde 2026-10-01, contactos desde 2026-10-05) → `meta.warnings` contiene "El gasto solo cubre del 2026-10-05".
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(widgets): métricas de Meta sobre lib/ads con recorte de ventana`.

### Task 8: Comparación de KPI (periodo anterior / año anterior)

**Files:**
- Modify: `lib/widgets/engine.ts`
- Test: `scripts/verify-widgets.ts`, `section("compare")`

**Interfaces:**
- Produces: `QueryResult.compare`, no nulo solo si `time.compare !== "none"`, `groupBy` está vacío y el rango resuelto no es `null`.
  - `previous_period`: el rango desplazado hacia atrás por su propia duración.
  - `previous_year`: el rango menos un año (`subYears`).
  - Con rango `null` ("Todo el historial"), `compare = null` y se agrega la advertencia "Sin periodo anterior: el filtro es «Todo el historial»".

- [ ] **Step 1: Write the failing tests**:
  - `count` de opps con `range: absolute 2026-10-01..2026-10-31` y `previous_period` → `compare.totals[0]` = opps de 2026-08-31..2026-09-30 = 1 (o1).
  - Con `range: "inherit"` y `ctx.dateRange = null` → `compare === null` y la advertencia está presente.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(widgets): comparación de periodo en KPI`.

### Task 9: Validación semántica con sugerencias

**Files:**
- Create: `lib/widgets/validate.ts`
- Test: `scripts/verify-widgets.ts`, `section("validate")`

**Interfaces:**
- Produces:
  - `interface Catalog { fields: Record<SourceId, Set<string>>; customFields: Record<"contacts" | "opportunities", Set<string>>; stages: string[]; pipelineNames: string[]; apptStatuses: string[]; adsStatus: AdsStatus | "pending" }`
  - `buildCatalog(ctx: EngineContext): Catalog`
  - `interface ValidationIssue { path: string; message: string; suggestion: string | null }`
  - `validateWidget(spec: WidgetSpec, catalog: Catalog): ValidationIssue[]`. Lista vacía = válido. Los mensajes van en español y le hablan al modelo.

  Reglas (§6.5):
  - el campo existe en la fuente;
  - `metricAllowed`;
  - `bucket` solo sobre campos de fecha;
  - `join` solo sobre dimensiones relacionadas;
  - `line`/`area` exigen una dimensión de fecha con bucket como primera dimensión;
  - `funnel` exige `funnelState` (o `stage`) en opportunities;
  - `stacked_bar`/`grouped_bar` exigen 2 dimensiones;
  - `kpi` exige 0 dimensiones;
  - `area` con 2 dimensiones es error ("área solo con una serie");
  - `cpl` exige la fuente `ads_daily`;
  - `record_list` exige 0 dimensiones y `limit` no nulo;
  - cada condición de cada cláusula usa un campo válido: en `filters`, de la fuente; en `relatedFilters`, de `ENTITY_FIELDS[entity]` o un `cf:` conocido de ese objeto;
  - un `relatedFilters` con `entity` igual al objeto de la fuente es error ("usa `filters`");
  - `ads_daily` no admite `filters` ni `relatedFilters` de CRM.

  La sugerencia es el campo conocido más parecido (distancia de edición normalizada ≤0.4, sin distinguir mayúsculas ni acentos).

- [ ] **Step 1: Write the failing tests**:
  - `cf:Origen` cuando existe "Origen de Lead" → un issue con `suggestion === "cf:Origen de Lead"`.
  - `viz: "line"` con `groupBy` `stage` → un issue en `path "viz"`.
  - `metric: "show_rate"` sobre opportunities → un issue.
  - El spec del ejemplo del dueño → `[]`.
  - "Contactos con negocio perdido" (`relatedFilters` sobre opportunity con la cláusula OR estado/etapa) → `[]`.
  - Un `relatedFilters` con `entity: "opportunity"` y condición `cf:No Existe` → un issue.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(widgets): validación semántica con sugerencias para el modelo`.

### Task 10: Descripciones (ScopePill, snapshot y catálogo para la IA)

**Files:**
- Create: `lib/widgets/describe.ts`
- Test: `scripts/verify-widgets.ts`, `section("describe")`

**Interfaces:**
- Produces:
  - `describeWidget(spec: WidgetSpec): string`, determinista. El orden es fuente · métrica · agrupación (con la regla de unión dicha en palabras: "por etapa de la oportunidad más reciente") · periodo ("hereda fechas" | etiqueta del preset | "1 oct – 31 oct 2026") · "ignora los filtros de CRM" si es Meta. Las tres métricas de leads se nombran explícitamente ("leads = oportunidades de pauta").
  - `buildPanelSnapshot(doc: DashboardDoc, activeTabId: string | null, selectedWidgetId: string | null, filtersLine: string): string`. El formato es exactamente el de §9.1 y empieza con la línea `=== PANEL ACTUAL ===`. `filtersLine` llega ya escrito (lo produce `describeFilterState` de la Tarea 18B) y va como línea "Filtros del panel: …". Los ids van entre corchetes para que el modelo pueda referenciarlos.
  - `describeWidget` también describe los filtros propios y entre objetos en palabras: las cláusulas OR se unen con "o" y las cláusulas con "y" ("con alguna oportunidad con (estado = perdida o etapa = «Negocio Perdido»)", "sin ninguna oportunidad", "solo pipeline Ventas"). Usa las etiquetas de `ENTITY_FIELDS` y la traducción de enums (`lost` → "perdida"), y agrega "ignora los filtros del panel" con `globalFilters: "ignore"`.
  - `buildPanelSnapshot` agrega la línea `Glosario del cliente: «término» (objeto) = nota · …` (u omite la línea si `doc.glossary` está vacío).
  - `PANEL_SNAPSHOT_MARKER = "=== PANEL ACTUAL ==="`
  - `buildPanelCatalogSummary(ctx: EngineContext): string`. Lleva los pipelines con sus etapas en orden, los campos personalizados por entidad, los estados de cita y el estado de Meta. Va en el bloque de `system` cacheado por sesión, así que debe ser estable (orden alfabético).

- [ ] **Step 1: Write the failing tests**:
  - `describeWidget` del ejemplo del dueño = `"Citas · conteo · por etapa de la oportunidad más reciente · hereda fechas"`.
  - Con `join: "each"` contiene `"cuenta una vez por cada oportunidad"`.
  - Un spec de `cpl` contiene `"ignora los filtros de CRM"` y `"leads = oportunidades de pauta"`.
  - "Contactos con negocio perdido" con la cláusula OR contiene `"con alguna oportunidad con (estado = perdida o etapa = «Negocio Perdido»)"`; `relatedFilters` `opportunity none []` → `"sin ninguna oportunidad"`.
  - Con un doc que tiene una entrada de glosario, `buildPanelSnapshot` contiene `"Glosario del cliente: «perdido»"`.
  - `buildPanelSnapshot` con 2 pestañas empieza con `PANEL_SNAPSHOT_MARKER` y contiene `"Seleccionado: [w8]"`.
  - `buildPanelCatalogSummary` llamado dos veces con el mismo ctx devuelve exactamente la misma cadena.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(widgets): describeWidget y snapshot del panel`.

### Task 10B: Resolución de términos (`resolveTerm`)

El código no decide qué significa "perdido", "activo" o "calificado". Esta
función solo **busca evidencia** en los datos de la cuenta para que la IA
razone y, si hace falta, pregunte (§6.7).

**Files:**
- Create: `lib/widgets/terms.ts`
- Test: `scripts/verify-widgets.ts`, `section("terms")`

**Interfaces:**
- Consumes: `resolveCtx`, `listFieldValues`, `ENTITY_FIELDS`, `knownCustomFields`, `contactsMatchingRelated` (Tarea 3).
- Produces:
  - `ENUM_LABELS_ES: Record<string, Record<string, string>>`: solo traducción de enums de GHL.
    - `opportunity.status`: `open` "abierta", `won` "ganada", `lost` "perdida", `abandoned` "abandonada";
    - `appointment.status`: `showed` "asistió", `noshow` "no asistió", `confirmed` "confirmada", `cancelled` "cancelada", `new` "nueva", `invalid` "inválida";
    - `task.status`: `pending` "pendiente", `completed` "completada".
  - `normalizeTerm(s: string): string`: minúsculas, sin acentos (NFD), espacios colapsados.
  - `termRoots(s: string): string[]`: raíces de cada palabra de ≥4 letras. Se quita el sufijo más largo de `["es","os","as","s","o","a"]` mientras la raíz quede en ≥4 letras. `"perdidos"` → `["perdid"]`; `"clientes activos"` → `["client","activ"]`.
  - `interface TermCandidate { entity: EntityId; field: string; fieldLabel: string; values: string[]; matched: string; kind: "value" | "field_name"; clause: FilterClause; records: number; contacts: number }`
  - `interface TermResolution { term: string; candidates: TermCandidate[]; overlaps: { a: number; b: number; both: number; onlyA: number; onlyB: number }[]; unionContacts: number; materiallyDifferent: boolean }`
  - `resolveTerm(term: string, entityHint: EntityId | null, ctx: EngineContext): TermResolution`
    - **Dónde busca**: los valores de `listFieldValues` de: opportunity `status`, `stage`, `pipelineName`, `lostReason`, `source`, `cf:*`; contact `tags`, `source`, `attributionMedium`, `cf:*`; appointment `status`; task `status`; pauta `tipo`. También los **nombres** de los `cf:` (`kind: "field_name"`, con `clause` = `is_not_empty`).
    - **Coincidencia**: un valor (o su etiqueta de `ENUM_LABELS_ES`) coincide si, normalizado, es igual al término normalizado o contiene **todas** las raíces del término. Los valores que coinciden del mismo campo se agrupan en un candidato (`op: "in"`).
    - **Conteos y salida**: `contacts` = `contactsMatchingRelated({ entity, quantifier: "any", conditions: [clause] })`. Con `entityHint`, primero los de ese objeto. Máximo 8 candidatos, ordenados por `contacts`.
    - **Traslape**: `overlaps` se calcula entre los 4 primeros, por contactos.
    - **`materiallyDifferent`**: ≥2 candidatos con `records ≥ 3` y `records ≥ 5%` del mayor, y algún par entre ellos con Jaccard (`both / (both+onlyA+onlyB)`) < 0.9.

- [ ] **Step 1: Write the failing tests** con `makeLostFixture()` de la Tarea 5. Agrégale el tag `"perdido"` a k4 y un contacto k5 con `cf "Estatus": "Activo"`.
  - `termRoots("perdidos")` → `["perdid"]`.
  - `resolveTerm("perdidos", null, ctx)` → candidatos que incluyen opportunity `status` `["lost"]` (por la etiqueta "perdida"), opportunity `stage` `["Negocio Perdido"]` y contact `tags` `["perdido"]`.
  - `unionContacts === 3` (k1, k2, k4) y `materiallyDifferent === false`: cada candidato tiene 1 registro, menos que el mínimo de 3.
  - Con 10 copias de q1 y 10 de q3 en contactos distintos → `materiallyDifferent === true`.
  - `resolveTerm("asistió", "appointment", ctx)` → el primer candidato es appointment `status` `["showed"]`.
  - `resolveTerm("activo", null, ctx)` → incluye contact `cf:Estatus` `["Activo"]`.
  - `resolveTerm("xyz123", null, ctx).candidates` → `[]`.
  - Ningún candidato aparece si el término solo coincide en menos de 4 letras ("pe" → `[]`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(widgets): resolveTerm busca dónde vive un concepto en los datos`.

### Task 11: El asistente actual sobre el motor (`aggregate`, `relate`, "ganada", conceptos ambiguos)

**Files:**
- Modify: `lib/ai-tools.ts`:
  - `aggregateRows` (L1484-1543) delega en `groupAndMeasure`;
  - `aggregate` (L1545) acepta `groupBy` relacionadas y `"<campoFecha>:<bucket>"`;
  - `applyOppFilters` (L1739) cambia `status` y acepta `won`;
  - `filteredRows` y `applyEntityFilters` aceptan `clauses` para todas las entidades;
  - `listFields` (L1138) agrega `semantic` por fuente;
  - herramienta nueva `resolve_term` en `TOOL_DEFINITIONS` y en `executeTool`;
  - descripciones de `aggregate.groupBy`, `status`, `won` y `clauses`.
- Modify: `lib/ai-context.ts`. Reemplaza el ejemplo L264 y la regla de "Cruces" (L255-267) en lo que toque a "citas por etapa", y agrega la regla 6 de "Cuándo preguntar". **No se recorta ninguna otra regla.**
- Test: `scripts/verify-widgets.ts`, `section("assistant")`

**Interfaces:**
- Consumes: `groupAndMeasure` (Tarea 5), `METRICS`, `matchesAll` (Tarea 3), `resolveTerm` (Tarea 10B).
- Produces, con forma de salida **sin cambios** (`{ groups: [{ key, count, sum?, avg?, contactIds? }], total, truncated }`):
  - `aggregate`: `metric` `count` → `count`; `sum` → `value_sum`; `avg` → `value_avg`. Sin plegado (`fold: false`); `truncated` = hubo más grupos que `limit`.
  - `groupBy: "opportunity.stage"` usa join `latest`; `groupBy: "createdAt:month"` agrupa por bucket.
  - `applyOppFilters`: `status: "won"` → `isWonOpp(o)`; `status: "open"` → `o.status === "open" && !isWonOpp(o)` (paridad con `sales-dashboard.tsx:182`); `lost` y `abandoned` no cambian. Filtro nuevo `won: boolean` (`isWonOpp`).
  - Filtro nuevo `clauses: FilterClause[]` en `search_*`, `aggregate`, `relate` (`from` y `to`) y `export_csv`, evaluado con `matchesAll`. Así se ejecuta "Todas las anteriores" (OR entre campos distintos).
  - `resolve_term` (`{ term: string, entityHint: string | null }`) → la `TermResolution` de la Tarea 10B, con la `clause` de cada candidato lista para pasar en `clauses`.
  - `ai-context.ts`, regla **6** de "Cuándo preguntar" (después de la 5): el texto de §6.7 punto 2, adaptado al tono del prompt.
    - "Concepto de negocio" = cualquier término que el usuario usa para un grupo de registros y que no es un campo literal ("perdidos", "clientes activos", "leads calificados", "citas efectivas"…). Es una **definición, no una lista**.
    - Usa `resolve_term`; pregunta con `ask_user` si hay lecturas materialmente distintas (apóyate en `materiallyDifferent` y en el traslape); las opciones llevan los nombres reales y el conteo en `hint`, más "Todas las anteriores" si combinar tiene sentido; con una sola lectura o casi el mismo conjunto, úsala y dilo; con cero, dilo y ofrece `list_values`.
    - Las definiciones de producto ("ganada", "de pauta", las tres de leads) se usan sin preguntar y se nombran.
  - `relate` conserva su semántica (oportunidades **de** los contactos de `from`), pero agrega con `groupAndMeasure`.

- [ ] **Step 1: Write the failing tests** con el fixture:
  - `executeTool("aggregate", { entity: "appointments", groupBy: "opportunity.stage", metric: "count" }, ds)` → grupos `{Propuesta: 3, "Sin oportunidad": 1}`.
  - `aggregate` de opportunities con `filters: { status: "won" }` → `total === 1` (o3, ganada por etapa).
  - **No regresión**: `aggregate({ entity: "contacts", groupBy: "tags", metric: "count" })` da la misma salida que antes del cambio. Se capturan los literales esperados ejecutando la versión de `main` **antes** de modificar y se pegan en la prueba.
  - `relate({ from: { entity: "appointments" }, to: { entity: "opportunities" }, groupBy: "stage", metric: "count" })` da la misma salida que antes.
  - Con `makeLostFixture()`: `aggregate` de opportunities con `filters: { clauses: [{ anyOf: [{ field: "status", op: "eq", values: ["lost"] }, { field: "stage", op: "in", values: ["Negocio Perdido"] }] }] }` → `total === 2`.
  - `relate({ from: { entity: "opportunities", filters: { clauses: <la misma> } }, to: { entity: "contacts" }, metric: "count" })` → `matchedContacts === 2`.
  - `executeTool("resolve_term", { term: "perdidos", entityHint: null }, ds)` → al menos 2 candidatos con `clause`.
- [ ] **Step 2: Run.** Expected: FAIL en las que usan lo nuevo.
- [ ] **Step 3: Implement.** En el prompt, el ejemplo de "citas por etapa de la oportunidad" pasa a `aggregate({ entity: "appointments", groupBy: "opportunity.stage", metric: "count" })`, con una línea que explique que `relate` responde otra pregunta ("las oportunidades de los contactos que tienen cita").
- [ ] **Step 4: Run** `pnpm verify:widgets && pnpm verify:attachments && npx tsc --noEmit`. Expected: PASS. `attachment-tools` importa `ai-tools`.
- [ ] **Step 5: Verify in the real app** (pestaña Asistente IA):
  - "¿Cuántas citas hay por etapa de la oportunidad?" y "¿cuántas oportunidades ganadas hay?" → usa `aggregate` con `opportunity.stage`, y las ganadas coinciden con el KPI de Ventas con el mismo filtro.
  - "Quiero ver los contactos con negocio perdido" en una cuenta donde "perdido" aparece en más de un lugar → llama `resolve_term` y pregunta con las lecturas reales de **esa** cuenta (por ejemplo: estado, la etapa «…», un tag) más "Todas las anteriores". Con la opción elegida, responde con `clauses`.
  - El mismo pedido en una cuenta donde solo hay una lectura → no pregunta y dice cuál usó.
  - Un concepto distinto ("clientes activos", "leads calificados") en una cuenta donde exista → el mismo comportamiento, sin código específico para esa palabra.
  - Un concepto que no aparece en los datos → lo dice y no inventa un criterio.
- [ ] **Step 6: Commit** `fix(asistente): aggregate sobre el motor; ganadas con isWonOpp; citas por etapa; resolve_term y cláusulas OR`.

### Task 12: Compuerta de paridad de la fase 0 (cuentas reales, solo lectura)

**Files:**
- Create: `scripts/check-widget-parity.ts`
- Modify: `package.json` (`"check:widget-parity": "tsx --env-file-if-exists=.env.local scripts/check-widget-parity.ts"`)

**Interfaces:**
- Consumes: `readSync(client)` (`lib/sync-store.ts`), `resolveClientById` (`lib/clients.ts`), `runQuery`.
- Produces: el comando `pnpm check:widget-parity <clientId> [<clientId>…]`.
  - Por cliente, carga el payload cacheado; **nunca** llama a GHL ni escribe.
  - Calcula cada referencia con funciones **copiadas** del tablero (cada una cita su archivo y rango de líneas).
  - Calcula lo mismo con `runQuery`.
  - Imprime una tabla ✅/❌ por gráfica × filtro.
  - Sale con código 1 si hay cualquier ❌.

  Matriz: filtros `{ all, last_30d } × { sin pipeline, el pipeline con más oportunidades }`. Referencias (§13, Fase 0):

  | Gráfica | Referencia copiada de | Spec del motor |
  |---|---|---|
  | Oportunidades por fuente | `marketing-dashboard.tsx` (usos de `sourceCategory` ~L632) | opportunities · count · `sourceCategory` |
  | Estado actual del embudo | `sales-dashboard.tsx:425-465` | opportunities · count · `funnelState` |
  | Resultado de las citas | `sales-dashboard.tsx:366-391` | appointments · count · `status` |
  | Razones de pérdida | `sales-dashboard.tsx:393-…` | opportunities · count · `lostReason` · filtro `status eq lost` |
  | KPI Conversión / Ingreso ganado | `sales-dashboard.tsx:179-189` | opportunities · `win_rate` / `won_value` |
  | Origen + conversión a cita | `sales-dashboard.tsx:340-360` | opportunities · `count`, `appointment_rate` · `platform` |

  Los conteos deben ser exactos y las tasas pueden diferir a lo más 1e-9. La etiqueta vacía de la referencia ("Sin razón") se mapea a `"(sin valor)"` antes de comparar.

- [ ] **Step 1: Write** el script.
- [ ] **Step 2: Run** `pnpm check:widget-parity lezgo-suite amir-cherit`. Expected: todas ✅. Si alguna falla, se corrige el motor, **nunca** la referencia, salvo que la referencia esté mal copiada.
- [ ] **Step 3: Commit** `chore(widgets): compuerta de paridad contra los tableros`.

---

# FASE 1 — El panel persistente

### Task 13: Operaciones puras sobre el documento

**Files:**
- Create: `lib/widgets/doc-ops.ts`
- Test: `scripts/verify-widgets.ts`, `section("doc-ops")`

**Interfaces:**
- Consumes: los tipos y `DOC_LIMITS` de la Tarea 1.
- Produces. Todas son puras, devuelven un doc nuevo y lanzan `DocOpError` (mensaje en español para el modelo) si hay un id desconocido o se excede un límite:
  - `type IdGen = () => string`
  - `interface OpMeta { now: string; by: "ai" | "user"; id: IdGen }`
  - `class DocOpError extends Error {}`
  - `addWidgets(doc, args: { tabId: string | null; newTabTitle: string | null; widgets: WidgetSpec[]; position: "start" | "end" }, meta: OpMeta): { doc: DashboardDoc; tabId: string; widgetIds: string[] }`. Se pasa exactamente uno de `tabId` / `newTabTitle`.
  - `updateWidget(doc, widgetId: string, spec: WidgetSpec, meta: OpMeta): DashboardDoc`. Conserva `id` y `createdAt` y actualiza `updatedAt`.
  - `deleteWidgets(doc, widgetIds: string[]): DashboardDoc`
  - `moveWidgets(doc, widgetIds: string[], toTabId: string): DashboardDoc`
  - `arrangeTab(doc, tabId: string, items: { widgetId: string; size: WidgetSpec["size"]; height: WidgetSpec["height"] }[]): DashboardDoc`. `items` debe ser una permutación exacta de los widgets de la pestaña.
  - `upsertTab(doc, args: { tabId: string | null; title: string; position: number | null }, id: IdGen): { doc: DashboardDoc; tabId: string }`
  - `deleteTab(doc, tabId: string): DashboardDoc`
  - `findWidget(doc, widgetId): { tab: Tab; widget: Widget } | null`
  - `setPanelFilters(doc, filters: { defaultDate: RangePreset | null; defaultPipelines: string[]; controls: Omit<FilterControl, "id">[] }, id: IdGen): DashboardDoc`. Conserva el `id` de los controles que ya existían con la misma clave (`field`: `entity`+`field`; `condition`: `entity`+`label`) y genera ids para los nuevos. Lanza con más de `maxControls`, con claves repetidas o con un control incoherente con su `kind`.
  - `saveTerm(doc, entry: Omit<GlossaryEntry, "id" | "createdAt">, meta: OpMeta): DashboardDoc`. Si el término o uno de sus alias ya existe (comparando con `normalizeTerm` de la Tarea 10B), **reemplaza** esa entrada y conserva su `id`. Lanza con más de `maxGlossary`.
  - `forgetTerm(doc, term: string): DashboardDoc`. Busca por término o alias normalizado y lanza `DocOpError` si no existe.

- [ ] **Step 1: Write the failing tests**:
  - `addWidgets` en una pestaña nueva crea la pestaña y devuelve 2 ids.
  - El widget 25 en una pestaña lanza `DocOpError` (`maxWidgetsPerTab`).
  - La pestaña 13 lanza.
  - `arrangeTab` con un id faltante lanza.
  - **Review Focus 5:** `updateWidget(doc, "no-existe", …)` lanza `DocOpError` con un mensaje que contiene `"ya no existe"`; `deleteTab` de un id desconocido también lanza.
  - El doc original queda intacto después de cada operación (comparar con `structuredClone` previo).
  - `setPanelFilters` con 9 controles lanza; volver a guardar un control existente conserva su `id`.
  - `saveTerm` de "perdido" y luego de "Perdidos" con alias `["perdido"]` → una sola entrada, la segunda, con el mismo `id`. `forgetTerm(doc, "PERDIDO")` la borra.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(widgets): operaciones puras sobre el documento del panel`.

### Task 14: Persistencia en Neon, versiones e interruptor `ai_panel`

**Files:**
- Modify: `scripts/db-migrate.ts`. Agrega las dos tablas de §10.1 y `ALTER TABLE dashboard_installation ADD COLUMN IF NOT EXISTS ai_panel boolean NOT NULL DEFAULT false`, y suma las tablas nuevas al listado final.
- Modify: `lib/installations.ts` (`listActiveInstallations` lee `ai_panel`), `lib/clients.ts` (`ClientConfig.aiPanel?: boolean`; `getRoster` lo mapea).
- Create: `lib/dashboard-store.ts`
- Create: `scripts/verify-dashboard-store.ts`
- Modify: `package.json` (`"verify:dashboard-store": "tsx --env-file-if-exists=.env.local scripts/verify-dashboard-store.ts"`)

**Interfaces:**
- Consumes: `getSql` (`lib/db.ts`), `parseDoc`, `emptyDoc`, `DOC_LIMITS`.
- Produces (server-only):
  - `interface StoredDoc { doc: DashboardDoc; version: number }`
  - `readDoc(clientId: string): Promise<StoredDoc>`. Sin fila → `{ doc: emptyDoc(), version: 0 }`.
  - `writeDoc(clientId: string, doc: DashboardDoc, expectedVersion: number, change: string, source: "ai" | "user"): Promise<{ ok: true; version: number } | { ok: false; current: StoredDoc }>`
  - `listVersions(clientId: string): Promise<{ version: number; change: string; source: string; createdAt: string }[]>`
  - `restoreVersion(clientId: string, version: number, expectedVersion: number, change: string): Promise<Awaited<ReturnType<typeof writeDoc>>>`
  - `checkDocSize(doc: DashboardDoc): boolean` (≤ `maxDocBytes` en JSON UTF-8)

  Algoritmo de `writeDoc`: **una sola sentencia** para que doc y versión sean atómicos. Es el patrón "decide dentro del WHERE" de `claimSync`.

  ```sql
  -- expectedVersion > 0
  WITH upd AS (
    UPDATE dashboard_doc SET doc = ${json}::jsonb, version = version + 1, updated_at = now(), updated_by = ${source}
     WHERE client_id = ${clientId} AND version = ${expectedVersion}
    RETURNING version, doc)
  INSERT INTO dashboard_doc_version (client_id, version, doc, change, source)
  SELECT ${clientId}, version, doc, ${change}, ${source} FROM upd
  RETURNING version
  -- expectedVersion = 0: el mismo CTE con
  -- INSERT INTO dashboard_doc (...) VALUES (..., 1, ...) ON CONFLICT (client_id) DO NOTHING RETURNING version, doc
  ```

  Sin filas devueltas → `{ ok: false, current: await readDoc(clientId) }`. Después de un éxito se recorta el historial con `DELETE FROM dashboard_doc_version WHERE client_id = $1 AND version <= $new - 50`. Ese recorte es best-effort: se registra en el log y no falla la escritura.

- [ ] **Step 1: Write the failing tests** en `scripts/verify-dashboard-store.ts`, con un `clientId` de prueba `__verify__<timestamp>` que se borra al final. Sin `DATABASE_URL`, el script imprime "omitido" y sale con 0, como `verify:sync-store`.
  - Primera escritura con `expectedVersion: 0` → `version 1`.
  - Una escritura con `expectedVersion: 0` repetida → `ok: false`.
  - **Review Focus 4:** dos escrituras con `expectedVersion: 1` → la primera `ok`, la segunda `ok: false` y `current.version === 2`.
  - Después de 55 escrituras, `listVersions` devuelve ≤50 entradas.
  - `restoreVersion(v1)` → `readDoc` igual al doc de la v1 y `version` nuevo = último + 1.
  - `checkDocSize` de un doc de 300 KB → `false`.
- [ ] **Step 2: Run** `pnpm db:migrate && pnpm verify:dashboard-store`. Expected: FAIL (el store no existe). Antes de migrar, confirma que `DATABASE_URL` apunta a `ep-frosty-term-awf7asfw`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:dashboard-store && pnpm verify:clients && pnpm verify:installations && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(panel): dashboard_doc con versiones y escritura condicional; interruptor ai_panel`.

### Task 15: API `/api/dashboards`

**Files:**
- Create: `app/api/dashboards/route.ts`, `app/api/dashboards/restore/route.ts`

**Interfaces:**
- Consumes: `requireClient`, `unauthorized` (`lib/session.ts`), el store (Tarea 14), `dashboardDocSchema`.
- Produces (`export const runtime = "nodejs"`):
  - `GET /api/dashboards` → `200 { enabled: boolean, doc, version }`. Con `enabled === false` no se lee la BD y se devuelve `doc: emptyDoc(), version: 0`.
  - `PUT /api/dashboards` con body `{ doc, expectedVersion: number, change: string, source: "ai" | "user" }`:
    - `200 { version }`;
    - `409 { doc, version }` (conflicto);
    - `400 { error, issues }` (zod);
    - `413` (tamaño);
    - `403` si `!client.aiPanel`.
  - `POST /api/dashboards/restore` con body `{ version: number, expectedVersion: number }` → las mismas respuestas que PUT.
  - `change` se recorta a 200 caracteres. El `clientId` siempre es `client.id` de `requireClient()`.

- [ ] **Step 1: Implement** las dos rutas.
- [ ] **Step 2: Verify** con `pnpm dev` y un cliente con `ai_panel = true` (`UPDATE dashboard_installation SET ai_panel = true WHERE client_id = 'lezgo-suite'`):
  - `curl` con la cookie de sesión. `GET` → `enabled: true, version: 0`.
  - `PUT` válido → `version: 1`.
  - El mismo `PUT` otra vez → `409`.
  - `PUT` con `title` de 200 caracteres → `400`.
  - Sin cookie → `401`.
  - Con un cliente sin el interruptor, `PUT` → `403`.
- [ ] **Step 3: Run** `npx tsc --noEmit && pnpm lint`. Expected: limpio.
- [ ] **Step 4: Commit** `feat(panel): API de lectura, escritura y restauración del panel`.

### Task 16: Hook `useDashboardDoc`

**Files:**
- Create: `hooks/use-dashboard-doc.ts`

**Interfaces:**
- Consumes: la API de la Tarea 15 y `emptyDoc`.
- Produces:

  ```ts
  type CommitResult =
    | { ok: true; version: number }
    | { ok: false; reason: "conflict" | "invalid" | "network" | "disabled"; message: string }
  function useDashboardDoc(): {
    enabled: boolean | null; doc: DashboardDoc | null; version: number; loading: boolean; error: string | null
    commit(mutate: (d: DashboardDoc) => DashboardDoc, change: string, source: "ai" | "user"): Promise<CommitResult>
    undo(): Promise<CommitResult>   // version > 1 → restore(version - 1); version === 1 → commit(emptyDoc)
    canUndo: boolean
    reload(): Promise<void>
  }
  ```

  - `commit` aplica el cambio **de forma optimista**, manda `PUT` con `expectedVersion` y, si falla, revierte al doc anterior.
  - Un 409 deja el doc y la versión del servidor y devuelve `reason: "conflict"` con el mensaje "El panel cambió en otra sesión; ya se recargó". `mutate` puede lanzar `DocOpError`, que se convierte en `reason: "invalid"` con el mensaje del error.
  - Los `commit` se serializan con una cola de promesas para que dos herramientas en paralelo no compitan por `expectedVersion`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc --noEmit`. Expected: limpio. La verificación funcional se hace en la Tarea 18.
- [ ] **Step 3: Commit** `feat(panel): hook useDashboardDoc con commit optimista, cola y deshacer`.

### Task 17: Render de widgets

**Files:**
- Create en `components/widgets/`:
  - `widget-card.tsx`;
  - `viz-kpi.tsx`, `viz-bar.tsx` (cubre `bar`, `bar_horizontal`, `stacked_bar` y `grouped_bar`), `viz-line.tsx` (`line` y `area`), `viz-funnel.tsx`, `viz-table.tsx`, `viz-record-list.tsx`, `viz-text.tsx`;
  - `widget-drill.tsx`;
  - `format.ts`.

**Interfaces:**
- Consumes: `runQuery`, `QueryError`, `describeWidget`; de `dashboard-ui.tsx`: `DashboardCard`, `ChartCardHeader`, `ChartCardContent`, `ScopePill`, `ChartEmpty`, `ChartHint`, `KpiCard`, `NonZeroTooltipContent`, `CHART_PALETTE`, `BRAND_AMBER`, `PipelineScopeNotice`; `ChartDrillDrawer`/`DrillState` y `AppointmentDrillDrawer`.
- Produces:
  - `<WidgetCard widget={Widget} ctx={EngineContext} selected={boolean} onEditWithAi={(id) => void} onEditFilters={(id) => void} onDelete={(id) => void} />`. Calcula con `useMemo([widget, ctx])` y atrapa `QueryError` y cualquier `Error`.
  - `formatMetric(value: number | null, metric: MetricId, currency?: string): string`. Las tasas como `12.5%`, los montos de Meta con la moneda de `ads.currency` o sin símbolo si no la hay, el resto con `toLocaleString("es-MX")` y `null` como `"—"`.
  - `colorForKey(key: string, index: number): string`. El color es estable por valor dentro de una sesión: un mapa de módulo valor → índice de `CHART_PALETTE` según el orden de aparición. Ámbar solo en la serie 0.
  - `<WidgetDrill>`: elige el cajón según la fuente. opportunities → `ChartDrillDrawer` con `opportunities`; contacts y tasks → `contactItems`; pautas → `pautaItems`; appointments → `AppointmentDrillDrawer`.

  Estados de la tarjeta:
  - Error → `ChartEmpty` con "No se pudo calcular: {mensaje}. Pídele a la IA que la ajuste."
  - `meta.adsStatus` `"pending"` → aviso ámbar "Todavía no revisamos el gasto de Meta para esta cuenta; presiona Actualizar."
  - Cualquier otro estado distinto de `connected` → aviso ámbar con `meta.adsMessage`.
  - `meta.crmFiltersIgnored` con algún filtro de CRM activo → aviso equivalente a `PipelineScopeNotice`: "Meta no tiene pipeline, asesor ni etapa: este bloque ignora esos filtros".
  - Chips bajo el título con los filtros **propios** del widget y su periodo si es fijo ("Mes pasado · fijo", "Pipeline: Ventas · fijo", "Con alguna oportunidad con estado = perdida"). Los chips cuyo campo está en `meta.overriddenGlobals` dicen "fijo".
  - El menú ⋯ agrega "Filtros y fechas", que llama a `onEditFilters(id)`. El editor se implementa en la Tarea 18B.
  - `meta.warnings` → `ChartHint`.
  - 0 filas → `ChartEmpty` "Sin datos para este periodo".

  El header lleva el título, un `ScopePill` con `label` corto (la agrupación) y `tooltip = describeWidget(widget)`, y los botones ✨ y ⋯. El menú ⋯ de la fase 1 solo tiene "Editar con IA" y "Eliminar"; el resto es de la fase 2.

  Las vistas del funnel no muestran % entre pasos (§7.1). La tabla usa `tabular-nums` y se ordena al hacer clic en el encabezado. `record_list` abre `DetailDrawer`/drill al hacer clic en una fila.

- [ ] **Step 1: Implement** los componentes.
- [ ] **Step 2: Verify in the real app** con una página temporal de desarrollo. En `app/page.tsx` detrás de `?widgets-demo=1`, renderiza 9 widgets fijos (uno por `viz`) sobre los datos reales. Confirma visualmente:
  - colores y ámbar;
  - tooltips;
  - clic → drill con los registros correctos;
  - **Review Focus 1:** un widget con `cf:Campo Borrado` muestra el mensaje y no un 0;
  - un widget de `cpl` en una cuenta sin Meta muestra el aviso ámbar;
  - tema oscuro.

  La página temporal se quita en la Tarea 18.
- [ ] **Step 3: Run** `npx tsc --noEmit && pnpm lint`. Expected: limpio.
- [ ] **Step 4: Commit** `feat(panel): render de widgets con drill-down y estados explícitos`.

### Task 18: Cuadrícula, pestañas e integración en la página

**Files:**
- Create: `components/widgets/widget-grid.tsx`, `components/widgets/panel-tabs.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `useDashboardDoc`, `WidgetCard`, los doc-ops y el estado de filtros que ya existe en `page.tsx` (`dateRange`, `pipelineFilter`, `data`).
- Produces:
  - `<WidgetGrid tab={Tab} ctx={EngineContext} selectedWidgetId onSelect onEditWithAi onDelete />`. Es un grid CSS de 12 columnas: `size` s/m/l/xl = 3/6/8/12 columnas en `lg`, 6/12/12/12 en `md` y 12 en móvil; `height` compact/normal/tall = 140/300/440 px. Se usa `grid-auto-flow: dense`.
  - `<PanelTabs tabs activeId onSelect onRename onDelete onAdd fixedTabs={[{id:"marketing"},{id:"sales"},{id:"conversations"}]} />`. Las pestañas del doc van primero; luego Marketing, Ventas y Asistente IA, fijas. Renombrar y borrar desde el menú de la pestaña. Borrar una pestaña con widgets pide confirmación con un `AlertDialog`.
  - En `page.tsx`, `DashboardTab` pasa a ser `string`:
    - Si `enabled === true`, se usa `PanelTabs`.
    - La pestaña inicial es la primera del doc o, si no hay, la vista del panel vacío (id `"__empty__"`, Tarea 19).
    - Si `enabled !== true`, la navegación actual queda **idéntica**.
    - `engineCtx` se memoiza con `{ dataset: { …data, messages }, pipelines: allPipelines, ads: data?.ads, dateRange, pipelineFilter, globalFilters: [], now }`, donde `now` se recalcula cada minuto con el `forceTick` existente. `globalFilters` queda vacío hasta la Tarea 18B.
    - La `FilterBar` se muestra también en las pestañas del doc.
    - El borrado manual de un widget usa `commit(d => deleteWidgets(d, [id]), "Eliminó «título»", "user")` y muestra un toast `sonner` con el botón "Deshacer" → `undo()`.

- [ ] **Step 1: Implement** y quita la página temporal de la Tarea 17.
- [ ] **Step 2: Verify in the real app** con `lezgo-suite` (`ai_panel = true`):
  - Crea una pestaña a mano con un `PUT` de prueba o con la herramienta de la Tarea 20 cuando exista.
  - Recargar conserva todo.
  - Borrar un widget y luego "Deshacer" lo restaura.
  - Cambiar el filtro de fechas recalcula los widgets que heredan y no los que tienen periodo fijo.
  - Un cliente **sin** el interruptor ve exactamente la navegación de hoy (Marketing / Ventas / Asistente IA).
  - **Review Focus 4:** con dos pestañas del navegador, borra un widget en una y luego en la otra. La segunda recibe el toast de conflicto y muestra el doc recargado.
- [ ] **Step 3: Run** `npx tsc --noEmit && pnpm lint`. Expected: limpio.
- [ ] **Step 4: Commit** `feat(panel): cuadrícula y pestañas dinámicas detrás de ai_panel`.

### Task 18B: Filtros globales, por gráfica y entre objetos (estado e interfaz)

**Files:**
- Create: `lib/widgets/filter-state.ts`, `hooks/use-panel-filters.ts`, `components/widgets/panel-filter-bar.tsx`, `components/widgets/filter-field-picker.tsx`, `components/widgets/widget-filter-editor.tsx`
- Modify: `app/page.tsx` (la barra del panel en las pestañas del doc y `engineCtx.globalFilters`), `components/widgets/widget-grid.tsx` (pasa `onEditFilters`)
- Test: `scripts/verify-widgets.ts`, `section("filter-state")`

**Interfaces:**
- Consumes: `PanelFilters`, `FilterControl`, `setPanelFilters`, `updateWidget`, `ENTITY_FIELDS`, `listFieldValues`, `resolveWidgetRange`, `DateRangeFilter` y `PipelineFilterControl` existentes, `useDashboardDoc`.
- Produces:
  - En `lib/widgets/filter-state.ts`, todo puro:
    - `interface PanelFilterState { date: DateFilter; pipelines: string[]; values: Record<string, string[]>; on: Record<string, boolean>; temporary: Omit<FilterControl, "id">[] }`.
      - `values`: valores elegidos de los controles `field`. `on`: si cada control `condition` está encendido. Ambos usan el id del control como clave.
      - `temporary`: chips de sesión sin control guardado, de cualquiera de los dos tipos. Su selección vive en el propio objeto: `defaultValues` como valores elegidos y `defaultOn` como encendido.
    - `initialFilterState(filters: PanelFilters, now: Date): PanelFilterState`. Convierte `defaultDate`: `last_7d` → `{preset:"week"}`, `last_30d` → `{preset:"month"}`, `all` o `null` → `{preset:"all"}`, y el resto → `{preset:"custom", from, to}` con `resolveWidgetRange`.
    - `activeGlobalFilters(state, filters): ActiveGlobalFilter[]`: los controles `field` y temporales con al menos un valor, convertidos a cláusula `in`, más las `condition` encendidas con su `clause`.
    - `isDefaultState(state, filters, now): boolean`
    - `stateAsDefaults(state, filters): PanelFilters`, para "Guardar como predeterminado". Los temporales se vuelven controles.
    - `describeFilterState(state, filters, pipelines: Pipeline[]): string`, la línea "Fecha = … (predeterminado: …) · Pipeline = … · Asesor = Ana (temporal) · …" del snapshot (§9.1).
    - `staleValues(state, filters, ctx: ResolvedCtx): Record<string, string[]>`: por control, los valores elegidos que hoy no aparecen en `listFieldValues`.
  - `usePanelFilters(doc: DashboardDoc | null, now: Date)` → `{ state, setDate, setPipelines, setValues(controlId, values), setOn(controlId, on), addTemporary(control: Omit<FilterControl, "id">), pinTemporary(index), removeControl(controlId), addControl(control: Omit<FilterControl, "id">), reset(), saveAsDefault(), replaceState(next: PanelFilterState) }`. `replaceState` es para `apply_filters` (Tarea 20).
    - El estado se inicializa **una vez** cuando el doc llega. Si los controles del doc cambian, se agregan o quitan valores sin pisar lo que el usuario eligió en los demás.
    - `addControl`, `removeControl`, `pinTemporary` y `saveAsDefault` hacen `commit(d => setPanelFilters(d, …), "<cambio>", "user")`.
    - La interacción con el "último mes automático" de las cuentas grandes (`autoScopedRef` en `page.tsx`) se mantiene solo cuando `defaultDate === null`.
  - `<PanelFilterBar>`: la fila de §4.2. Lleva la fecha, el pipeline, un chip por control `field` ("Asesor: Ana ×"; clic para editar valores; menú "Quitar filtro"), un chip que se prende y apaga por control `condition` (con su nota en el tooltip), los chips temporales en estilo punteado con "Fijar", "+ Filtro", y "Restablecer" / "Guardar como predeterminado" solo si `!isDefaultState`. Los valores obsoletos se muestran tachados con "(sin datos)".
  - `<FilterFieldPicker entityScope={EntityId[]} onPick={(entity, field, values, quantifier) => void} allowQuantifier={boolean} />`.
    - Paso 1: lista de campos agrupada por objeto, con buscador y etiquetas de `ENTITY_FIELDS` más los `cf:`.
    - Paso 2: multiselección de valores con conteos (`listFieldValues`) y buscador.
    - Con `allowQuantifier`, un selector "Que tenga alguna / Que no tenga ninguna", solo para objetos distintos de la fuente.
    - Frase de confirmación en palabras ("Contactos que tengan alguna oportunidad con Estado = perdida").
  - `<WidgetFilterEditor widget onSave={(spec) => void} />`, que se abre desde ⋯ → "Filtros y fechas":
    - **Periodo**: "Heredar del panel" o un preset de `RANGE_PRESETS` o un rango; además, "Fecha usada" entre los `dateFields` de la fuente.
    - **Filtros propios** (lista con ×, "+ Filtro" con `FilterFieldPicker` restringido al objeto de la fuente).
    - **Filtros entre objetos** (lista con ×, "+ Filtro de otro objeto" con `allowQuantifier`).
    - Interruptor "Ignorar los filtros del panel" (`globalFilters`).
    - Guardar hace `commit(d => updateWidget(d, id, spec, meta), "Cambió los filtros de «título»", "user")` con deshacer.

- [ ] **Step 1: Write the failing tests** para `filter-state.ts`:
  - `initialFilterState` con `defaultDate: "last_30d"` → `date.preset === "month"`; con `"last_month"` → `preset "custom"` con `from` = primer día del mes anterior.
  - `activeGlobalFilters` omite los controles sin valores y las `condition` apagadas, e incluye los temporales con valores. Una `condition` encendida aporta su `clause` sin cambios.
  - `stateAsDefaults` convierte un temporal en control con `defaultValues` = sus valores.
  - `describeFilterState` contiene `"Asesor = Ana (temporal)"`.
  - **Review Focus 3:** con un control "Asesor" cuyo predeterminado es `["Ana"]` y ningún registro asignado a Ana, `staleValues` → `{ <id>: ["Ana"] }`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** el módulo puro, el hook y los componentes, y conecta `engineCtx.globalFilters = activeGlobalFilters(state, doc.filters)` en `page.tsx`.
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Verify in the real app** (`lezgo-suite`):
  - "+ Filtro" → Oportunidad › Asesor → Ana. Todos los widgets de citas y contactos se reducen a los contactos con alguna oportunidad de Ana.
  - Recargar conserva el control pero vuelve al valor predeterminado ("todos").
  - "Guardar como predeterminado" y recargar → Ana sigue elegida; "Deshacer" lo revierte.
  - En una gráfica, ⋯ → "Filtros y fechas" → "Mes pasado" + "Que tenga alguna oportunidad con Estado = perdida". Aparecen sus chips y el filtro global de fecha ya no la mueve.
  - Un control `condition` guardado (lo crea la IA en la Tarea 21) se prende y apaga desde su chip y los widgets se recalculan.
  - Un widget con "Pipeline: Ventas · fijo" sigue mostrando Ventas cuando la barra elige otro pipeline.
  - Un widget de Meta muestra el aviso "ignora esos filtros".
  - **Review Focus 3:** guarda como predeterminado un asesor y renómbralo en los datos (o usa un valor inexistente con un `PUT` de prueba). El chip aparece tachado con "(sin datos)" y los widgets dicen "Sin datos para este filtro".
  - Las pestañas clásicas Marketing y Ventas siguen con solo fecha y pipeline.
- [ ] **Step 6: Commit** `feat(panel): filtros globales extensibles, por gráfica y entre objetos`.

### Task 19: Panel vacío y sugerencias

**Files:**
- Create: `lib/widgets/suggestions.ts`, `components/widgets/empty-panel.tsx`
- Test: `scripts/verify-widgets.ts`, `section("suggestions")`

**Interfaces:**
- Produces:
  - `interface Suggestion { label: string; prompt: string }`
  - `buildSuggestions(ctx: EngineContext): Suggestion[]`. Devuelve de 4 a 6, deterministas:
    - "Leads por fuente este mes" (siempre que haya contactos);
    - "Citas por etapa del pipeline" (solo si hay citas);
    - "Embudo de ventas" (si hay oportunidades);
    - "Ventas ganadas por asesor" (si hay alguna ganada con `isWonOpp`);
    - "¿Cuánto me cuesta cada lead?" (solo si `ads?.status === "connected"`);
    - "Leads de pauta por campaña" (solo si hay pautas).
  - `<EmptyPanel suggestions onSubmit={(text) => void} />`. Es el layout de §4.1: la caja "¿Qué quieres ver?", chips con las sugerencias y la línea "o empieza con un panel armado: Marketing · Ventas". En la fase 1, esas dos plantillas mandan al copiloto el prompt "Arma una pestaña de Marketing con los indicadores clave" (o la de Ventas). Enviar cualquier cosa abre el copiloto (Tarea 21) con ese texto.

- [ ] **Step 1: Write the failing tests**:
  - Con `ads: undefined`, ninguna sugerencia contiene "cuesta".
  - Con `ads.status "connected"`, una sí.
  - Sin citas, no aparece "Citas por etapa".
  - El resultado tiene entre 4 y 6 elementos para el fixture.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(panel): panel vacío con sugerencias según los datos`.

### Task 20: Herramientas del panel y modo `panel` en `/api/chat`

**Files:**
- Create: `lib/widgets/tools.ts`, `lib/chat-request.ts`
- Modify: `app/api/chat/route.ts` (usa `buildChatRequest`), `hooks/use-agent-loop.ts`, `lib/ai-context.ts` (agrega `PANEL_PROMPT_SECTION`)
- Test: `scripts/verify-widgets.ts`, `section("panel-tools")`

**Interfaces:**
- Consumes: doc-ops, `runQuery`, `validateWidget`/`buildCatalog`, `describeWidget`, `WIDGET_SPEC_JSON_SCHEMA`, `TOOL_DEFINITIONS`.
- Produces:
  - `PANEL_TOOL_DEFINITIONS`, todas con `strict: true`: las herramientas de fase 1 de §8.1 (`get_dashboard`, `preview_widget`, `create_widgets`, `update_widget`, `delete_widgets`, `move_widgets`, `arrange_tab`, `upsert_tab`, `delete_tab`, `get_widget_data`, `set_panel_filters`, `apply_filters`, `save_term`, `forget_term`) con las entradas de esa tabla. `resolve_term` ya está en `TOOL_DEFINITIONS` (Tarea 11), así que entra por `PANEL_MODE_TOOLS`. `widget`/`widgets[]` referencian `WIDGET_SPEC_JSON_SCHEMA`. Las descripciones van en inglés, como las existentes; los mensajes de resultado, en español.
  - `PANEL_MODE_TOOLS` = `TOOL_DEFINITIONS` sin `render_chart`, `show_in_panel`, `create_pdf`, `list_uploaded_files`, `query_uploaded_table` ni `join_uploaded_table`, seguido de `PANEL_TOOL_DEFINITIONS`. El orden es fijo.
  - `interface PanelToolDeps { getDoc(): DashboardDoc; commit: ReturnType<typeof useDashboardDoc>["commit"]; engineCtx(): EngineContext; activeTabId(): string | null; selectedWidgetId(): string | null; setActiveTab(id: string): void; getFilterState(): PanelFilterState; applyFilterState(next: PanelFilterState): void; now(): string; newId(): string }`
    - `set_panel_filters` → `commit(d => setPanelFilters(d, …), …, "ai")`. `defaultPipelines` llega con **nombres** de pipeline y se convierte a ids (un nombre desconocido es error con sugerencia).
    - `apply_filters` → calcula el nuevo `PanelFilterState` y llama a `applyFilterState`. Los `values` sobre campos sin control y las `conditions` van a `temporary`. No escribe el doc y devuelve `{ ok: true, filters: describeFilterState(...) }`.
    - `save_term` / `forget_term` → `commit(d => saveTerm(d, …) / forgetTerm(d, …), "Glosario: «término»", "ai")`. Antes de guardar, las cláusulas de `meaning` se validan con los campos del `entity` (mismas reglas que `validateWidget`).
    - `get_dashboard` incluye `describeFilterState` y la lista de controles con sus valores disponibles (los primeros 20 de `listFieldValues`).
  - `isPanelTool(name: string): boolean`
  - `executePanelTool(name: string, input: Record<string, unknown>, deps: PanelToolDeps): Promise<unknown>`
    - Antes de cualquier commit se valida con `widgetSpecSchema` y `validateWidget`. Si hay issues, la herramienta devuelve `{ error, issues }` y la Tarea 20 marca `is_error`.
    - `preview_widget` y `get_widget_data` devuelven `{ scope: describeWidget, rows: primeras 15 filas como { label, values }, totals, recordCount, warnings, adsStatus }`.
    - Las mutaciones devuelven `{ ok: true, version, widgetIds? }`. Si `commit` falla con `conflict`, devuelven `{ error: "El panel cambió en otra sesión; vuelve a leerlo con get_dashboard." }`.
    - `create_widgets` cambia la pestaña activa a la de destino.
  - `buildChatRequest(args: { mode: "assistant" | "panel"; datasetSummary: string; messages: Anthropic.MessageParam[]; userTimezone: string; maxTokens?: number }): Anthropic.MessageCreateParamsNonStreaming`. Es el cuerpo exacto que hoy arma `route.ts:114-145`. En modo `panel`, `tools = PANEL_MODE_TOOLS` y el primer bloque de `system` es `ASSISTANT_SYSTEM_PROMPT + "\n\n" + PANEL_PROMPT_SECTION`.
  - `route.ts` acepta `mode` en el body (por defecto `"assistant"`).
  - `useAgentLoop` recibe opciones nuevas, opcionales y retrocompatibles:
    - `mode?: "assistant" | "panel"`, que se manda al body;
    - `executeExtra?: (name, input) => Promise<unknown> | undefined`, que se consulta **antes** del `executeTool` por defecto;
    - `decorateUserText?: () => string | null`, cuyo resultado no nulo se agrega como **segundo** bloque `text` del mensaje de usuario en `send()`.

  El resultado de una herramienta que devuelve un objeto con `error` se manda con `is_error: true`.

  `PANEL_PROMPT_SECTION` (español) incluye:
  - las reglas de selección de §7.2;
  - las uniones `latest`/`each` y cuándo usar cada una;
  - las tres métricas de leads y la regla de costo;
  - "usa `preview_widget` antes de crear";
  - "crea varios widgets en UNA llamada a `create_widgets`";
  - confirmar con `ask_user` antes de borrar una pestaña con widgets o más de 3 widgets;
  - "nunca imprimas ids de widgets ni pestañas";
  - "responde en una línea qué creaste y con qué regla";
  - "si piden conversión entre etapas, explica que no hay historial de etapas" (§7.1);
  - filtros (§6.6): "por ahora / muéstrame solo" → `apply_filters`; "agrega un filtro / que siempre" → `set_panel_filters`; un filtro que es de **una** gráfica → `update_widget` con `filters` / `relatedFilters` / `time`; los filtros entre objetos usan `relatedFilters` con `any`/`none`, y las condiciones sobre el mismo objeto van juntas en un solo `relatedFilters`;
  - conceptos de negocio: primero el glosario del snapshot; si no está, la regla 6 de "Cuándo preguntar" (`resolve_term` → pregunta solo si las lecturas difieren). Después de que el usuario elige, `save_term` y una línea "Lo recordaré: «término» = …". Los widgets reciben las cláusulas **expandidas**. Si el usuario redefine un término, ofrece actualizar los widgets que usaban el significado anterior.
  - Un concepto que combina campos y se quiere tener a mano en la barra → `set_panel_filters` con un control `kind: "condition"`.

- [ ] **Step 1: Write the failing tests** con deps en memoria (`commit` que aplica `mutate` sobre una variable y versiona):
  - `create_widgets` con el spec del ejemplo del dueño y `newTabTitle "Citas"` → `ok`, el doc tiene 1 pestaña y 1 widget, y `setActiveTab` se llamó.
  - `create_widgets` con `cf:Origen` → `error` con `issues[0].suggestion === "cf:Origen de Lead"` y el doc sin cambios.
  - **Review Focus 5:** `update_widget` con un `widgetId` borrado → `{ error }` con "ya no existe", sin lanzar.
  - **Review Focus 4:** `commit` simulado que devuelve `conflict` → `{ error }` que contiene `"get_dashboard"`.
  - `preview_widget` → `scope === describeWidget(spec)` y `rows.length ≤ 15`.
  - `set_panel_filters` con un control `{ entity: "opportunity", field: "assignedTo", label: null, defaultValues: [] }` → el doc tiene 1 control con `label === "Asesor"`. Con `defaultPipelines: ["No Existe"]` → `{ error }` con sugerencia.
  - `apply_filters` con `values: [{ entity: "contact", field: "source", values: ["Meta"] }]` sin control → `applyFilterState` recibió un estado con un temporal `contact.source` y la versión del doc no cambió.
  - `save_term({ term: "perdido", aliases: ["perdidos"], entity: "opportunity", meaning: [<cláusula OR estado/etapa>], note: "estado perdida o etapa «Negocio Perdido»" })` → el doc tiene 1 entrada y `buildPanelSnapshot` la muestra. Con un `meaning` sobre un campo inexistente → `{ error, issues }`.
  - `set_panel_filters` con un control `kind: "condition"` (label "Perdidos", con la cláusula OR) → `activeGlobalFilters` con `on` = `defaultOn` lo incluye.
  - Ningún objeto anidado de `PANEL_TOOL_DEFINITIONS` tiene `additionalProperties` distinto de `false` (mismo recorrido de la Tarea 1).
  - `buildChatRequest({ mode: "assistant", … })` es igual, campo por campo, al cuerpo que armaba la ruta antes del cambio (literal capturado de `main`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:widgets && npx tsc --noEmit && pnpm lint`. Expected: PASS. Si el tipo `Anthropic.Tool` de 0.98 no acepta `strict`, se agrega con un tipo local que lo extienda y la Tarea 21 verifica que la API lo acepte.
- [ ] **Step 5: Verify in the real app.** La pestaña Asistente IA funciona igual que antes: haz una pregunta con `render_chart` y confirma que el contador de costo sigue sumando.
- [ ] **Step 6: Commit** `feat(panel): herramientas estrictas del panel y modo panel en /api/chat`.

### Task 21: Copiloto lateral

**Files:**
- Create: `components/widgets/copilot-dock.tsx`
- Modify: `app/page.tsx` (monta el copiloto; ✨ selecciona el widget y abre el copiloto; el panel vacío envía al copiloto)

**Interfaces:**
- Consumes: `useAgentLoop` (con `mode: "panel"`, `executeExtra`, `decorateUserText`), `executePanelTool`, `buildDatasetSummary`, `buildPanelCatalogSummary`, `buildPanelSnapshot` (con `filtersLine = describeFilterState(...)`), `PANEL_SNAPSHOT_MARKER`, `useDashboardDoc`, `usePanelFilters` y `ChatQuestion` (`components/dashboard/chat-question.tsx`, para `ask_user`).
- Produces: `<CopilotDock open onClose engineCtx docApi activeTabId setActiveTabId selectedWidget={Widget | null} clearSelection filters={ReturnType<typeof usePanelFilters>} locationId syncedAt initialPrompt={string | null} />`.
  - `datasetSummary = buildDatasetSummary(dataset, locationId, syncedAt) + "\n\n" + buildPanelCatalogSummary(ctx)`, memoizado **solo** por las referencias del dataset para no romper la caché.
  - En los mensajes del usuario se ocultan los bloques que empiezan con `PANEL_SNAPSHOT_MARKER`.
  - Si hay un widget seleccionado, aparece el chip "Editando: {título}" con una ×.
  - Debajo de cada respuesta que modificó el panel aparece el botón "Deshacer" (→ `docApi.undo()`).
  - Se muestran el costo acumulado y el estado ("Pensando…", "Ejecutando create_widgets…"), como en `conversations-chat.tsx`.
  - Ancho fijo de 380 px en `lg`; en móvil es una hoja inferior (`vaul`, que ya está instalado).
  - La conversación persiste mientras la página esté montada: el copiloto queda montado y oculto, igual que la regla de la pestaña Asistente IA.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify in the real app** con `lezgo-suite` y el panel vacío:
  1. Chip "Citas por etapa del pipeline" → aparece un widget de barras con citas por `opportunity.stage`. El ScopePill dice "por etapa de la oportunidad más reciente" y la respuesta explica la regla en una línea.
  2. "Hazla mensual" con el widget seleccionado → `update_widget`, la gráfica cambia y el `prompt` original se conserva.
  3. "Arma una pestaña de Ventas" → `ask_user` por el foco (regla 5 existente) y luego una pestaña nueva con varios widgets en una sola llamada `create_widgets`.
  4. "Pon los KPI arriba" → `arrange_tab`.
  5. "Borra la pestaña Ventas" → pide confirmación y luego la borra. "Deshacer" la restaura.
  6. Recargar conserva todo.
  7. "Quiero ver los contactos con negocio perdido" en una cuenta donde "perdido" vive en más de un lugar:
     - llama `resolve_term` y pregunta con las lecturas de esa cuenta y sus conteos;
     - con "Todas las anteriores", crea una lista de contactos con `relatedFilters` y la cláusula OR, y el ScopePill lo dice en palabras;
     - guarda el término (`save_term`).
     En una conversación nueva, "¿cuántos perdidos hubo este mes?" ya **no** pregunta y dice "uso tu definición de «perdido»…". Repite con un concepto distinto que exista en la cuenta ("clientes activos").
  8. "Muéstrame solo lo de Meta" → chip temporal "Fuente: Meta" en la barra; el doc no cambia de versión. "Agrega un filtro de asesor al panel" → control nuevo guardado.
  9. "Esta gráfica siempre del mes pasado" con un widget seleccionado → `update_widget` con `time.range: "last_month"` y el chip "Mes pasado · fijo".
  10. En los registros del servidor (o en `usage` de la respuesta), `cacheReadTokens > 0` desde el segundo turno, lo que prueba que la caché no se rompe.
  11. La API acepta `strict: true` (sin 400).
- [ ] **Step 3: Run** `npx tsc --noEmit && pnpm lint && pnpm verify:widgets`. Expected: limpio.
- [ ] **Step 4: Commit** `feat(panel): copiloto lateral con snapshot del panel y deshacer`.

### Task 22: Evaluación de lenguaje natural (corpus y runner)

**Files:**
- Create: `scripts/eval-panel/corpus.ts`, `scripts/eval-panel/run.ts`
- Modify: `package.json` (`"eval:panel": "tsx --env-file-if-exists=.env.local scripts/eval-panel/run.ts"`), `.gitignore` (`eval-results/`)

**Interfaces:**
- Consumes: `readSync`, `resolveClientById`, `buildChatRequest`, `executeTool`, `executePanelTool` con deps en memoria, `runQuery` y el SDK de Anthropic.
- Produces:
  - `corpus.ts` exporta `CASES: { id: string; prompt: string; kind: "create" | "edit" | "ambiguous" | "destructive"; setup?: WidgetSpec[]; reference?: (ctx: EngineContext) => Record<string, number> | number }[]` con 30 casos en español:
    - 18 de creación, incluido "las citas organizadas por oportunidades de pipeline";
    - 5 de edición sobre un `setup`;
    - 4 ambiguos (pauta, fuente, periodo, "panel completo"), donde lo esperado es un `ask_user`;
    - 3 destructivos, donde lo esperado es confirmación;
    - entre los de creación y edición, al menos 4 de filtros: "contactos con cita pero sin oportunidad", "agrega un filtro de asesor al panel", "muéstrame solo lo de Meta", "esta gráfica siempre del mes pasado";
    - y al menos 4 de **conceptos ambiguos**, elegidos mirando los datos reales de cada cuenta del eval (no inventados): dos donde el concepto vive en varios lugares con traslape bajo (lo esperado es `resolve_term` + `ask_user` con esas lecturas), uno donde vive en un solo lugar (sin pregunta) y uno inexistente (lo dice, sin inventar). Más uno de **glosario**: con una entrada sembrada en el doc, el mismo concepto no debe preguntar.
    - Cada `reference` se escribe con filtros directos sobre los arreglos, **sin** importar `lib/widgets/*` (§14).
  - `run.ts <clientId> [<clientId>…]`:
    - corre el loop en Node contra la API, con un máximo de 15 turnos por caso;
    - contesta cualquier `ask_user` con la primera opción;
    - compara el número del widget creado (vía `runQuery`) con `reference`;
    - escribe `eval-results/panel-<fecha>.json` con por caso: el spec, si coincide, los turnos y el costo estimado con `PRICING`;
    - imprime el % de coincidencia y el costo total.

- [ ] **Step 1: Write** el corpus y el runner. El runner **no** se ejecuta en esta tarea.
- [ ] **Step 2: Present to the owner** el corpus para aprobación (pregunta 6 del spec) y el costo estimado (30 casos × 2 cuentas × ~5 turnos). **No ejecutes `pnpm eval:panel` sin su aprobación explícita del presupuesto.**
- [ ] **Step 3: Run** (solo con la aprobación) `pnpm eval:panel lezgo-suite amir-cherit`. Expected: ≥90% de coincidencia en los casos de creación y edición, y el resto en pregunta o error visible. Si queda por debajo, se ajustan el prompt o las descripciones de las herramientas y se repite.
- [ ] **Step 4: Commit** `chore(panel): corpus y runner de la evaluación de lenguaje natural`.

### Task 23: Documentación

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document**, siguiendo el estilo existente:
  - En Commands: `pnpm verify:widgets`, `verify:dashboard-store`, `check:widget-parity`, `eval:panel` (con la advertencia de costo).
  - Una sección "Panel autogestionable por IA" que cubra:
    - el principio "se guarda la pregunta, no la respuesta";
    - los módulos de `lib/widgets/*`;
    - la unión `latest`/`each`;
    - la regla de paridad;
    - las tres métricas de leads;
    - el embudo sin % entre pasos;
    - el interruptor `ai_panel` y cómo encenderlo (`UPDATE dashboard_installation SET ai_panel = true WHERE client_id = …`);
    - que `dashboard_doc` **no es desechable** y no se borra en UNINSTALL;
    - el snapshot en el mensaje y no en `system` (caché).
  - En "AI assistant": `aggregate` acepta `opportunity.*` y `campo:bucket`; "ganada" usa `isWonOpp`; filtro `clauses` (OR entre campos); `resolve_term` y la regla 6 de "Cuándo preguntar".
  - Una subsección "Conceptos ambiguos y glosario":
    - no hay reglas fijas por palabra;
    - `resolve_term` solo busca evidencia;
    - se pregunta solo con lecturas materialmente distintas;
    - el glosario por cliente vive en `dashboard_doc`;
    - los widgets guardan cláusulas expandidas;
    - en la fase 1 la pestaña Asistente IA no lee el glosario.
  - Una subsección "Filtros del panel":
    - las tres capas;
    - `any`/`none` con condiciones en el mismo registro;
    - registros relacionados sin filtro de fecha;
    - precedencia del widget sobre el global;
    - valores de sesión contra predeterminados guardados;
    - Meta ignora todos los filtros de CRM;
    - las pestañas clásicas solo reciben fecha y pipeline.
- [ ] **Step 2: Run** `npx tsc --noEmit && pnpm verify:widgets && pnpm verify:dashboard-store`. Expected: PASS.
- [ ] **Step 3: Commit** `docs: panel autogestionable por IA en CLAUDE.md`.
