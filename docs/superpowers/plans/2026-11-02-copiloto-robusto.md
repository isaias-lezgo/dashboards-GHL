# Copiloto más robusto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the panel copilot build what the hand-built client dashboards repeat. That means:
- several sources in one chart, and proportions;
- custom DATE fields, and fields that combine several custom fields;
- ganada/abierta/perdida, the matrix and "días desde";
- conversations as a source, and VAEO's "sin atención" matrix;
- an honest "no" that offers the closest option.

**Architecture:** Everything stays declarative. A widget is still a `QuerySpec` recomputed by the pure engine (`lib/widgets/*`). The new capabilities are **optional** spec properties, and absent means the old behavior, so saved docs keep opening untouched. Multi-series widgets run one sub-query per series and merge them into the same 2-dimension `QueryResult` shape that the viz layer already pivots. Conversations come from a new read-only NDJSON route, loaded on demand by a browser hook and handed to the engine through `EngineContext`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, zod 3, Recharts 2, date-fns, Neon, @anthropic-ai/sdk. Verification is tsx assertion scripts (no test framework), Playwright MCP on the real app, and the paid eval only with owner approval.

**Spec:** `docs/superpowers/specs/2026-11-02-copiloto-robusto-design.md` (approved 2026-11-02). Also read `CLAUDE.md` → "AI-managed panel (`ai_panel`)": every invariant there still holds.

## Global Constraints

- Branch `feat/panel-ia` (spec §4). Never `main`. Commit per task.
- `npx tsc --noEmit` must pass at the end of every task, because `next build` ignores TS errors. Use pnpm only.
- **Old docs open with no manual step.** Every new spec property is optional, with null or absent meaning the old behavior. `schemaVersion` stays `1`.
- **The question is saved, never the answer.** The model never writes a number. Widgets store expanded definitions, never references to glossary terms.
- **Same unit per chart, never a dual axis** (spec §3.1). Series must share `METRICS[m].kind`, except the two inputs of a ratio.
- **No stacked bars across series of different sources** (spec §3.1, ruling 1). No `compare` with series (ruling 2).
- **Custom DATE fields:**
  - Only a custom field whose GHL `dataType` is `"DATE"` is a date. Never infer a date from how the text looks.
  - Values are read as a UTC calendar date: `new Date(utcY, utcM, utcD)` local (spec §3.3).
- **Undated records** are out of any widget that has a period. The card says so with this copy: `«N» <sustantivo> sin «<campo>» no aparecen`, and the line is clickable (ruling 3).
- **Same-group proportions** count related conditions over all time (cohort, owner's decision). The card copy is `Cuenta hasta hoy: los periodos recientes siguen madurando.`
- **Between-series ratio** card copy: `«<A>» y «<B>» no son los mismos registros: el cociente compara ritmos, no es una conversión.`
- **Contacts queries with a relatedFilter on `opportunity`** ignore the global pipeline filter. Card copy: `Ignora el filtro de pipeline: con él, todos los contactos tendrían oportunidad.` (ruling 8)
- **Conversations window:**
  - The default is `60` days and there is no cap. The window is per card (`conversationDays`), and the panel date filter never widens it (owner's decision).
  - Exact copy when the window is over 60 days: `Recomendamos limitar el periodo a 60 días o menos para reducir el tiempo de carga.`
  - Copy when the card's period is wider than the window: `Mostrando los últimos <N> días de conversaciones.`
  - A contact with no messages in the window falls in `Más de <N> días o sin mensajes`.
  - Automated outbound messages count as outbound (ruling 4). Conversations never enter `project_sync` (ruling 5).
- **"Días desde" default edges** are `[7, 15, 30, 60]`, with labels `0–7 días`, `8–15 días`, `16–30 días`, `31–60 días`, `Más de 60 días`. Future dates go in `Fecha futura`, missing dates in `Sin fecha`.
- **Outcome field:** `outcome` takes the values `Ganada` (= `isWonOpp`), `Perdida` (lost or abandoned and not won) and `Abierta`, in that order. Colors are fixed: green, slate blue, red.
- **Combined fields** use "first field with a value" for grouping AND filtering (ruling 7). At most 3 fallbacks.
- **Strict tools:**
  - The API compiles at most ~9 strict tools per request.
  - `save_term` becomes non-strict (Task 11), which leaves 8 strict.
  - After touching any strict schema, run `pnpm check:strict-tools` (~$0.05).
- **The Asistente IA request body stays byte-identical.** The existing `buildChatRequest` equality check must keep passing.
- **No GHL writes.** The conversations route is read-only and goes through `requireClient()` + `withClient()`, entered INSIDE the stream's `start()`.
- **`pnpm eval:panel` costs money.** Never run it without the owner approving the budget in this session.
- All user-facing copy is in Spanish. Never print GHL ids to the user.

## Review Focus

1. **A DATE custom field arriving as a number, a numeric string or an ISO string** is read as the same UTC calendar day. A value on the 1st at 00:00Z lands in that month, not the previous one. Pinned in Task 3 (`dateValue reads epoch number, epoch string and ISO the same day`).
2. **A ratio bucket whose denominator is 0**, or a ratio whose total denominator is 0, shows "—" (null). It never shows 0 or Infinity. Pinned in Task 5 (`ratio with zero denominator is null`).
3. **A conversation load that fails or is still running** must not draw zeros. The card shows loading or error with retry, and the copilot's preview gets an error, not a zero. Pinned in Task 8 (`pending conversations give a pending result, never zero rows`).
4. **A combined field with both fields filled with different values** counts the record only under the first field's value, in the chart AND in its filter. Pinned in Task 3 (`fallback filter agrees with fallback grouping`).
5. **Panel filter "Todo el historial" with a conversations card** loads 60 days only and says `Mostrando los últimos 60 días de conversaciones.` Pinned in Task 8 (`panel range wider than window shows the window notice`).

---

### Task 1: Spec vocabulary, optional properties, test kit

**Files:**
- Modify: `lib/widgets/spec.ts`
- Create: `scripts/lib/widget-test-kit.ts` (move `section`, `check`, `checkAsync`, `mkContact`, `mkOpp`, `mkAppt`, `makeFixture`, `Fixture`, `q`, `dim`, `byLabel`, `ids` out of `scripts/verify-widgets.ts`, exported unchanged)
- Modify: `scripts/verify-widgets.ts` (import the kit; update the pinned vocab and drift assertions)
- Create: `scripts/verify-capabilities.ts`
- Modify: `package.json` (`"verify:capabilities": "tsx scripts/verify-capabilities.ts"`)

**Interfaces:**
- Produces (all exported from `lib/widgets/spec.ts`):
  - `VIZ_TYPES` adds `"matrix"`, `SOURCES` adds `"conversations"`, `BUCKETS` adds `"age"`, and `FILTER_OPS` adds `"days_ago_gte"` and `"days_ago_lte"`.
  - `SOURCE_ENTITY` becomes `Record<Exclude<SourceId, "ads_daily" | "conversations">, EntityId>`. Conversations have no entity: no relatedFilters, no custom fields, no glossary.
  - `interface SeriesSpec { label: string; source: SourceId; metric: MetricId; filters: FilterClause[]; relatedFilters: RelatedFilterSpec[]; dateField: string; dimension: string | null }`
  - `interface RatioSpec { label: string; numerator: number; denominator: number }`. Index 0 is the query's own (primary) series, and `i ≥ 1` is `series[i-1]`.
  - Optional properties:
    - `GroupBySpec.fallbacks?: string[] | null` and `GroupBySpec.edges?: number[] | null`
    - `FilterSpec.fallbacks?: string[] | null`
    - `QuerySpec.series?: SeriesSpec[] | null`, `QuerySpec.ratio?: RatioSpec | null` and `QuerySpec.conversationDays?: number | null`
    - `FilterControl.fallbacks?: string[] | null`
    - `GlossaryEntry.kind?: "condition" | "field" | null` and `GlossaryEntry.fields?: string[] | null`
  - `DOC_LIMITS` adds `maxExtraSeries: 5`, `maxFallbacks: 3`, `maxAgeEdges: 8`, `defaultAgeEdges: [7, 15, 30, 60]` and `defaultConversationDays: 60`.
  - `TimeSpec.field` max length goes from 40 to 120, because custom date fields are `cf:<Name>`.
  - Normalizers: `seriesOf(q: QuerySpec): SeriesSpec[]`, `fallbacksOf(x: { fallbacks?: string[] | null }): string[]`, `edgesOf(g: GroupBySpec): number[]`, `conversationDaysOf(q: QuerySpec): number`, `glossaryKind(g: GlossaryEntry): "condition" | "field"`.
  - Test kit: `scripts/lib/widget-test-kit.ts` exports the moved helpers with identical signatures.

- [ ] **Step 1: Write the failing tests** in `scripts/verify-capabilities.ts`, section `specSection`:

```ts
check("a v1 doc saved before this change still parses", () => {
  const old = JSON.parse(JSON.stringify(LEGACY_DOC)); // a literal in the test: 1 tab, 2 widgets (kpi + stacked_bar with 2 groupBy), 1 control, 1 glossary entry — no new keys anywhere
  const doc = parseDoc(old);
  assert.equal(doc.tabs[0].widgets.length, 2);
  assert.equal(seriesOf(doc.tabs[0].widgets[0].query!).length, 0);
  assert.equal(glossaryKind(doc.glossary[0]), "condition");
});
check("new vocabulary is accepted", () => {
  for (const v of ["matrix"]) assert.ok((VIZ_TYPES as readonly string[]).includes(v));
  assert.ok((SOURCES as readonly string[]).includes("conversations"));
  assert.ok((BUCKETS as readonly string[]).includes("age"));
  assert.ok((FILTER_OPS as readonly string[]).includes("days_ago_gte"));
});
check("a multi-series widget with a ratio parses", () => {
  const w = { ...LEGACY_KPI, query: { ...LEGACY_KPI.query, series: [{ label: "Con oportunidad", source: "contacts", metric: "count", filters: [], relatedFilters: [{ entity: "opportunity", quantifier: "any", conditions: [] }], dateField: "createdAt", dimension: null }], ratio: { label: "% con oportunidad", numerator: 1, denominator: 0 }, conversationDays: null } };
  assert.ok(widgetSpecSchema.safeParse(w).success);
});
check("limits: 6 extra series, 4 fallbacks and 9 edges are refused", () => { /* three safeParse(...).success === false */ });
check("glossary field kind needs fields, condition kind needs meaning", () => {
  assert.ok(!dashboardDocSchema.safeParse(docWithGlossary({ kind: "field", fields: [], meaning: [] })).success);
  assert.ok(dashboardDocSchema.safeParse(docWithGlossary({ kind: "field", fields: ["cf:Sucursal VAEO", "cf:Sucursal MESH"], meaning: [] })).success);
});
check("normalizers give defaults", () => {
  assert.deepEqual(edgesOf({ dimension: "createdAt", bucket: "age", join: null }), [7, 15, 30, 60]);
  assert.equal(conversationDaysOf(q({})), 60);
  assert.deepEqual(fallbacksOf({}), []);
});
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL (`parseDoc`/`seriesOf` not exported or vocab missing).
- [ ] **Step 3: Implement** the Produces block in `lib/widgets/spec.ts`.
  - zod: the new properties are `.nullish()`; `glossaryEntryZ` refines by kind.
  - `WIDGET_SPEC_JSON_SCHEMA` gets the new properties as nullable and required, matching the file's existing style, with descriptions:
    - `series`: "Extra series sharing the x-axis; same unit unless a ratio uses them";
    - `ratio`: "numerator/denominator are series indexes: 0 = this query, 1.. = series";
    - `fallbacks`: "next fields to read, in order, when the previous is empty — 'contact.<field>' allowed from opportunities";
    - `edges`: "only with bucket 'age': upper bounds in days, ascending";
    - `conversationDays`: "days of conversations to load; null = 60. Only raise it when the user explicitly asks".
  - Move the helpers into the kit, then update `verify-widgets.ts`'s vocab pins and key-drift checks to the new keys.
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:widgets && npx tsc --noEmit`. Expected: all ✓, no TS errors.
- [ ] **Step 5: Commit** `feat(panel): vocabulario del spec para series, proporciones, campos combinados, antigüedad y conversaciones`

---

### Task 2: Custom field types in the payload and stage dates typed

**Files:**
- Modify: `lib/types.ts` (`Opportunity` gets `lastStageChangeAt?: string` and `lastStatusChangeAt?: string`; `DashboardPayload` gets `customFieldTypes?: Record<string, string>`)
- Modify: `lib/sync.ts`
- Modify: `lib/widgets/semantic.ts` (`EngineContext.customFieldTypes?: Record<string, string> | null`)
- Modify: `app/page.tsx` (pass `customFieldTypes: data?.customFieldTypes ?? null`)
- Test: `scripts/verify-capabilities.ts` (`syncSection`)

**Interfaces:**
- Produces:
  - `export function customFieldTypeMap(defs: GHLCustomField[]): Record<string, string>` in `lib/sync.ts`. The key is `` `${model}:${name}` ``, where `model` is `def.model ?? "contact"`, lower-cased. The value is `dataType` upper-cased; definitions with no dataType are skipped.
  - The payload carries the map.
  - `EngineContext.customFieldTypes`: `null` or absent means the cache predates types.

**Ruling:** spec §3.9 and §4 say the sync must start keeping `lastStageChangeAt`. It already does: `transformOpportunity` spreads the raw GHL record. Measured 2026-11-02, the field is present on 510/510 lezgo-suite and 3279/3279 condesa-cimatario opportunities. So no sync change and no "pendiente" notice for stage dates; only the type is added.

- [ ] **Step 1: Write the failing tests:**

```ts
check("customFieldTypeMap keys by model and name", () => {
  const m = customFieldTypeMap([
    { id: "1", name: "Fecha de Cierre", dataType: "DATE", model: "opportunity" },
    { id: "2", name: "Fecha de Cierre", dataType: "TEXT", model: "contact" },
    { id: "3", name: "Sin tipo" },
  ]);
  assert.deepEqual(m, { "opportunity:Fecha de Cierre": "DATE", "contact:Fecha de Cierre": "TEXT" });
});
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL (`customFieldTypeMap` not exported).
- [ ] **Step 3: Implement.** Export `customFieldTypeMap` and write `customFieldTypes` into the payload object `syncProject` builds. Type the two opportunity dates. Pass the map in `app/page.tsx`'s `engineCtx`.
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:sync-store && npx tsc --noEmit`. Expected: ✓.
- [ ] **Step 5: Commit** `feat(sync): guardar el tipo de cada campo personalizado`

---

### Task 3: Semantic layer — dates, combined fields, outcome, relative filters

**Files:**
- Modify: `lib/widgets/semantic.ts`, `lib/widgets/labels.ts`
- Test: `scripts/verify-capabilities.ts` (`semanticSection`)

**Interfaces:**
- Consumes: `fallbacksOf` (Task 1), `EngineContext.customFieldTypes` (Task 2).
- Produces:
  - `export function customFieldType(source: SourceId, cfName: string, ctx: EngineContext): string | null`. Only contacts and opportunities have custom fields; lookup is case-insensitive.
  - `export function isDateField(source: SourceId, field: string, ctx?: EngineContext): boolean`.
    - Covers `SOURCE_DEFS[source].dateFields`, `lastActivity` and `dateUpdated` as before.
    - Covers `cf:<Name>` when `customFieldType === "DATE"`.
    - Covers `contact.<dateField>` from a source that has a contact.
    - Update all 7 existing callers to pass `ctx` where they have one.
  - `export function dateValue(source: SourceId, row: Row, field: string, ctx: ResolvedCtx): Date | null`.
    - Reads native ISO, an epoch number, or a numeric string.
    - `cf:` DATE values → the local Date of the UTC calendar day.
    - `contact.<f>` resolves through `ctx.index.contactById`.
  - `export function fieldValuesWithFallbacks(source: SourceId, row: Row, fields: string[], ctx: ResolvedCtx): string[]`. It returns the values of the first field whose values are not all empty, or else `[EMPTY_VALUE]`. A field may be `contact.<f>` when the source has a contact.
  - `export type Outcome = "Ganada" | "Abierta" | "Perdida"`, `export const OUTCOME_ORDER: Outcome[] = ["Ganada", "Abierta", "Perdida"]` and `export function outcomeOf(opp: Opportunity): Outcome`. `"outcome"` is added to `DERIVED_FIELDS.opportunities` and `ENTITY_FIELDS.opportunity` (label `Estado (ganada/abierta/perdida)`).
  - `SOURCE_DEFS.opportunities.dateFields` adds `"lastStageChangeAt"` and `"lastStatusChangeAt"`.
  - `matchesFilter` changes:
    - honors `f.fallbacks` through `fieldValuesWithFallbacks([f.field, ...fallbacks])`;
    - `gt`/`gte`/`lt`/`lte` on dates compare `dateValue`;
    - `days_ago_gte` / `days_ago_lte` with `values[0] = N` compare whole local days between `startOfDay(dateValue)` and `startOfDay(ctx.now)`; a missing date is `false`.
  - `labels.ts` `FIELD_LABELS` adds `outcome: "estado"`, `lastStageChangeAt: "último cambio de etapa"`, `lastStatusChangeAt: "último cambio de estado"`.

- [ ] **Step 1: Write the failing tests:**

```ts
check("dateValue reads epoch number, epoch string and ISO the same day", () => {
  const ctx = resolveCtx(fixtureWithTypes({ "opportunity:Fecha de Cierre": "DATE" }));
  for (const v of [1790812800000, "1790812800000", "2026-10-01T00:00:00.000Z"]) {
    const d = dateValue("opportunities", { customFieldsResolved: { "Fecha de Cierre": v } }, "cf:Fecha de Cierre", ctx)!;
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 9, 1]);
  }
});
check("a TEXT custom field that looks like a date is not a date", () => {
  const ctx = fixtureWithTypes({ "contact:Fecha de última asignación": "TEXT" });
  assert.equal(isDateField("contacts", "cf:Fecha de última asignación", ctx), false);
});
check("unknown types (old cache) make custom dates unavailable", () => {
  assert.equal(isDateField("opportunities", "cf:Fecha de Cierre", fixtureWithTypes(null)), false);
});
check("fallbacks read the first filled field, crossing to the contact", () => {
  // o1: cf "Canal de contacto" = "WhatsApp"; o2: empty, its contact c2 has cf "Canal de Contacto" = "Facebook"; o3: neither
  assert.deepEqual(fieldValuesWithFallbacks("opportunities", o1, ["cf:Canal de contacto", "contact.cf:Canal de Contacto"], ctx), ["WhatsApp"]);
  assert.deepEqual(fieldValuesWithFallbacks("opportunities", o2, ["cf:Canal de contacto", "contact.cf:Canal de Contacto"], ctx), ["Facebook"]);
  assert.deepEqual(fieldValuesWithFallbacks("opportunities", o3, ["cf:Canal de contacto", "contact.cf:Canal de Contacto"], ctx), [EMPTY_VALUE]);
});
check("fallback filter agrees with fallback grouping", () => {
  // oBoth: "Sucursal VAEO" = "Tanarah", "Sucursal MESH" = "Valle"
  const f = { field: "cf:Sucursal VAEO", op: "eq" as const, values: ["Valle"], fallbacks: ["cf:Sucursal MESH"] };
  assert.equal(matchesFilter("opportunities", oBoth, f, ctx), false);
});
check("outcome follows isWonOpp and folds abandoned into Perdida", () => {
  assert.equal(outcomeOf({ ...base, status: "open", stage: "Negocio Ganado" }), "Ganada");
  assert.equal(outcomeOf({ ...base, status: "abandoned" }), "Perdida");
  assert.equal(outcomeOf({ ...base, status: "open" }), "Abierta");
});
check("days_ago filters count whole local days from ctx.now", () => {
  // now = 2026-10-29 12:00 local; lastStageChangeAt 2026-10-13 23:00 local = 16 days
  assert.equal(matchesFilter("opportunities", oStage16, { field: "lastStageChangeAt", op: "days_ago_gte", values: ["16"] }, ctx), true);
  assert.equal(matchesFilter("opportunities", oStage16, { field: "lastStageChangeAt", op: "days_ago_gte", values: ["17"] }, ctx), false);
});
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL.
- [ ] **Step 3: Implement** the Produces block.
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:widgets && npx tsc --noEmit`. Expected: ✓. The existing suite is unchanged, because native behavior is untouched.
- [ ] **Step 5: Commit** `feat(panel): fechas personalizadas, campos combinados, estado y filtros relativos en la capa semántica`

---

### Task 4: Engine — age buckets, custom-date windows, undated notice, matrix margins

**Files:**
- Modify: `lib/widgets/engine.ts`
- Test: `scripts/verify-capabilities.ts` (`engineDimsSection`)

**Interfaces:**
- Consumes: `isDateField`, `dateValue`, `fieldValuesWithFallbacks`, `edgesOf`, `OUTCOME_ORDER` (Tasks 1, 3).
- Produces:
  - `QueryError` code adds `"pending"`. Its message for a custom date when types are unknown: `«<Campo>» se podrá usar como fecha después de la próxima actualización`.
  - Age buckets:
    - `export function ageBucketKey(days: number | null, edges: number[]): string` returns `"a<index>"` for ranges, `"future"` for negative days and `EMPTY_VALUE` for null.
    - `ageBucketLabel(key, edges)` gives the copy in Global Constraints.
    - Every age range is always present, even when zero, in natural order.
  - `valuesFor` reads dates through `dateValue` and own/related fields through `fieldValuesWithFallbacks([dimension, ...fallbacks])`.
  - `applyRange` reads `dateValue`. When `time.field` is not the source's `primaryDate` and undated rows are dropped, it pushes `«N» <sustantivo> sin «<campo>» no aparecen` to `meta.warnings` and sets `meta.undated = { field, records }`.
  - `validateFields` accepts `time.field` and date dimensions when `isDateField(source, field, ctx)`, and throws `pending` for a custom date when `ctx.customFieldTypes` is null or undefined.
  - `outcome` gets natural order from `OUTCOME_ORDER`.
  - `QueryResult.margins: { first: Record<string, (number | null)[]>; second: Record<string, (number | null)[]> } | null`.
    - For 2-dimension results it measures each first-dim key and each second-dim key over its DEDUPED records. It does not sum cells.
    - It is `null` otherwise.

- [ ] **Step 1: Write the failing tests:**

```ts
check("age buckets: 7/8, 15/16, 60/61 borders, future and missing", () => {
  const e = [7, 15, 30, 60];
  assert.deepEqual([7, 8, 15, 16, 60, 61].map((d) => ageBucketKey(d, e)), ["a0", "a1", "a1", "a2", "a3", "a4"]);
  assert.equal(ageBucketKey(-1, e), "future");
  assert.equal(ageBucketKey(null, e), EMPTY_VALUE);
});
check("an age dimension shows every range even at zero, in order", () => {
  const res = runQuery(q({ groupBy: [{ dimension: "lastStageChangeAt", bucket: "age", join: null }], time: { ...ALL } }), ctx);
  assert.deepEqual(res.rows.map((r) => r.label[0]).slice(0, 5), ["0–7 días", "8–15 días", "16–30 días", "31–60 días", "Más de 60 días"]);
});
check("custom date window drops undated rows and says how many", () => {
  const res = runQuery(q({ metrics: [{ metric: "value_sum", label: null }], filters: [WON], time: { field: "cf:Fecha de Cierre", range: "absolute", from: "2026-10-01", to: "2026-10-31", compare: "none" } }), ctxWithCloseDates);
  assert.equal(res.totals[0], 3000);
  assert.ok(res.meta.warnings.includes("2 oportunidades sin «Fecha de Cierre» no aparecen"));
  assert.equal(res.meta.undated?.records.length, 2);
});
check("a close date of Oct 1 00:00Z buckets in October", () => {
  const res = runQuery(q({ groupBy: [{ dimension: "cf:Fecha de Cierre", bucket: "month", join: null }], time: ALL }), ctxWithCloseDates);
  assert.ok(byLabel(res)["oct 2026"]! >= 1);
});
check("custom date with an old cache is pending, not an unknown field", () => {
  assert.throws(() => runQuery(q({ time: { ...ALL, field: "cf:Fecha de Cierre" } }), { ...ctxWithCloseDates, customFieldTypes: null }), (e: unknown) => e instanceof QueryError && e.code === "pending");
});
check("margins measure deduped records, not summed cells", () => {
  // c1 has tags ["vip","b"] → in two cells of the tags column
  const res = runQuery(q({ source: "contacts", groupBy: [dim("assignedTo"), dim("tags")], time: ALL }), ctx);
  assert.equal(res.margins!.first["Ana"][0], 1);
});
check("outcome stacks in Ganada, Abierta, Perdida order", () => { /* groupBy [createdAt:month, outcome] → series order */ });
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL.
- [ ] **Step 3: Implement** the Produces block. Keep `fill` (gap-filling) for calendar buckets as is.
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:widgets && pnpm check:widget-parity amir-cherit hausmen && npx tsc --noEmit`. Expected: ✓, and parity is unchanged.
- [ ] **Step 5: Commit** `feat(panel): antigüedad en rangos, fechas personalizadas como eje y periodo, márgenes de matriz`

---

### Task 5: Engine — several series and proportions

**Files:**
- Modify: `lib/widgets/engine.ts`
- Test: `scripts/verify-capabilities.ts` (`seriesSection`)

**Interfaces:**
- Consumes: `seriesOf`, `RatioSpec` (Task 1); `margins`, `dateValue` (Tasks 3–4).
- Produces:
  - `runQuery(q, ctx)` dispatches to `runMultiQuery` when `seriesOf(q).length > 0 || q.ratio`.
  - Series 0 is the primary series: `{ label: q.metrics[0].label ?? METRIC_PHRASES[metric], source: q.source, metric: q.metrics[0].metric, filters, relatedFilters, dateField: q.time.field, dimension: null }`.
  - How each series runs:
    - It runs as a single-series sub-query with `compare: "none"`, the widget's `time.range/from/to` on its own `dateField`, and its own globals.
    - The axis depends on `q.groupBy[0]`:
      - If it is a date of the primary source, each series buckets its own `dateField` with the same bucket (and the same `edges` for age).
      - Otherwise the axis is the category `series.dimension ?? q.groupBy[0].dimension`, with the same fallbacks.
  - What the merged result looks like:
    - Rows have `label: [axisLabel, seriesLabel]` and `key: [axisKey, "s<i>"]`.
    - Date axes take the union of keys in chronological order. Category axes are ordered by the primary series' value and cut to `q.limit ?? 12`; the tail is recomputed per series from the folded records as `Otros`.
    - `totals` holds one value per series.
    - `meta.seriesLabels: string[]` and `meta.valueKind: "count" | "amount" | "rate"`.
  - How a ratio comes out:
    - One value per axis key: `num / den`, or `null` when `den` is 0 or null.
    - Each row's records are the numerator's, and it carries `parts: [num, den]`.
    - `totals = [numTotal / denTotal or null]`.
    - `meta.ratio = { kind: "same_group" | "between_series", numeratorLabel, denominatorLabel, parts: [numTotal, denTotal] }`.
    - `valueKind` is `"rate"` when both inputs have the same kind, `"amount"` for amount/count, and anything else is an `invalid` QueryError.
  - `same_group` requires all of these: the same `source`, the same `dateField`, every denominator clause deep-equal to some numerator clause, and the same for relatedFilters. Otherwise the ratio is `between_series` and the card shows the Global Constraints copy. `same_group` with a date axis or a period also shows `Cuenta hasta hoy: los periodos recientes siguen madurando.`
  - Shown series must share `METRICS[metric].kind`; otherwise it is an `invalid` QueryError with `Las series mezclan unidades (…); usa dos tarjetas.`
  - `globalPlan` exemption: when the source is `contacts` and any relatedFilter has `entity === "opportunity"`, it sets `applyPipeline = false`, `meta.pipelineIgnored = true` and the Global Constraints copy. This applies to single queries too.
  - `QueryRow.parts?: [number | null, number | null]`.

- [ ] **Step 1: Write the failing tests:**

```ts
check("contacts and opportunities created per week share one axis", () => {
  const res = runQuery(q({ source: "contacts", groupBy: [dim("createdAt", "week")], series: [series("Oportunidades", "opportunities", "count", "createdAt")], time: OCT }), ctx);
  assert.deepEqual(res.meta.seriesLabels, ["Contactos", "Oportunidades"]);
  assert.equal(res.totals[0], CONTACTS_IN_OCT);
  assert.equal(res.totals[1], OPPS_IN_OCT);
});
check("same-group proportion counts the condition over all time (cohort)", () => {
  // c9 created in Oct, its only opportunity created in Nov → counts as "con oportunidad"
  const res = runQuery(q({ source: "contacts", series: [series("Con oportunidad", "contacts", "count", "createdAt", { relatedFilters: [ANY_OPP] })], ratio: { label: "% con oportunidad", numerator: 1, denominator: 0 }, time: OCT }), ctx);
  assert.equal(res.meta.ratio!.kind, "same_group");
  assert.deepEqual(res.meta.ratio!.parts, [WITH_OPP_IN_OCT_EVER, CONTACTS_IN_OCT]);
  assert.ok(res.meta.warnings.includes("Cuenta hasta hoy: los periodos recientes siguen madurando."));
});
check("between-series ratio says they are not the same records", () => {
  const res = runQuery(q({ source: "opportunities", series: [series("Contactos", "contacts", "count", "createdAt")], ratio: { label: "Opps por contacto", numerator: 0, denominator: 1 }, time: OCT }), ctx);
  assert.equal(res.meta.ratio!.kind, "between_series");
  assert.ok(res.meta.warnings.some((w) => w.includes("no son los mismos registros")));
});
check("ratio with zero denominator is null", () => { /* a week with 0 contacts → row value null; empty window → totals [null] */ });
check("mixed units are refused", () => {
  assert.throws(() => runQuery(q({ series: [series("Valor", "opportunities", "value_sum", "createdAt")] }), ctx), /mezclan unidades/);
});
check("has-opportunity contact queries ignore the pipeline filter and say so", () => {
  const res = runQuery(q({ source: "contacts", relatedFilters: [NONE_OPP], time: ALL }), { ...ctx, pipelineFilter: ["p1"] });
  assert.equal(res.totals[0], CONTACTS_WITHOUT_OPP);
  assert.equal(res.meta.pipelineIgnored, true);
});
check("a single-source widget still returns exactly what it did", () => { /* deepEqual runQuery(old spec) vs a frozen expected for the makeFixture widgets */ });
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL.
- [ ] **Step 3: Implement** the Produces block.
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:widgets && pnpm check:widget-parity amir-cherit hausmen && npx tsc --noEmit`. Expected: ✓.
- [ ] **Step 5: Commit** `feat(panel): varias series en una gráfica y proporciones (mismo grupo y entre series)`

---

### Task 6: Validation with suggestions

**Files:**
- Modify: `lib/widgets/validate.ts`
- Test: `scripts/verify-capabilities.ts` (`validateSection`)

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: `validateWidget(spec, catalog)` returns these issues, each in Spanish with a suggestion:
  1. Series: `groupBy.length > 1` with series. A series `dateField` that is not a date of its source. A category axis invalid for a series' source. Mixed units without a ratio. `compare !== "none"` with series. Ratio indexes out of range or equal.
  2. Viz: `kpi` with series but no ratio. `stacked_bar` with series from different sources. `matrix` without exactly 2 groupBy and 1 metric, or with series.
  3. Ranges and fields: `bucket: "age"` on a non-date, or edges that are not ascending positive integers. A fallback field invalid for its source. More than `maxFallbacks`.
  4. Conversations: a conversations widget with a relatedFilter or a `cf:` field.
- `Catalog` adds `dateCustomFields: Record<"contacts" | "opportunities", Set<string>>` and `typesKnown: boolean`.

- [ ] **Step 1: Write the failing tests.** One `check` per rule: each builds the minimal bad spec and asserts `validateWidget(...)` has exactly one issue whose `path` and message substring match. Examples:

```ts
check("stacked bars across sources are refused", () => {
  const issues = validateWidget(stackedContactsAndOpps, catalog);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /no se apilan series de fuentes distintas/);
});
check("a kpi with two series and no ratio is refused", () => { /* … /necesita una proporción/ */ });
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:widgets && npx tsc --noEmit`. Expected: ✓.
- [ ] **Step 5: Commit** `feat(panel): validación de series, matriz, antigüedad y campos combinados`

---

### Task 7: Conversations — pure index and read-only route

**Files:**
- Create: `lib/conversation-index.ts` (pure, client-safe)
- Modify: `lib/ghl-client.ts` (add `searchConversationsPage`)
- Create: `app/api/conversation-index/route.ts`
- Test: `scripts/verify-capabilities.ts` (`conversationIndexSection`)
- Reference: `/Users/isaiasrios/Software/DASHBOARDS_VAEO/app/api/conversation-activity/route.ts` and its `searchConversationsPage` in `DASHBOARDS_VAEO/lib/ghl-client.ts`. Port the paging and the "open the thread only when it ends inbound" rule.

**Interfaces:**
- Produces (`lib/conversation-index.ts`):
  - `export interface ConversationRow { id: string; contactId: string; channel: string; assignedTo: string | null; lastMessageAt: string | null; lastDirection: "inbound" | "outbound" | null; unreadCount: number; createdAt: string | null; lastOutboundAt: string | null; lastInboundAt: string | null; waitingReply: boolean }`
  - `export function toIso(v: string | number | undefined | null): string | null` (epoch ms number, numeric string, or ISO)
  - `export function channelLabel(lastMessageType: string | undefined): string` (`TYPE_WHATSAPP` → `WhatsApp`, `TYPE_SMS` → `SMS`, `TYPE_EMAIL` → `Correo`, `TYPE_FACEBOOK` → `Facebook`, `TYPE_INSTAGRAM` → `Instagram`, `TYPE_CALL` → `Llamada`, otherwise `Otro`)
  - `export function needsThread(lastDirection: string | null, lastMessageAt: string | null, cutoffMs: number): boolean`
  - `export function lastOutboundFrom(messages: { direction: string; dateAdded: string; messageType?: string }[]): string | null` (skips `TYPE_ACTIVITY_*`; automated outbound counts)
  - `export interface ContactMessageDates { lastOutboundAt: string | null; lastInboundAt: string | null; lastMessageAt: string | null }`
  - `export function contactMessageDates(rows: ConversationRow[]): Map<string, ContactMessageDates>` (max per contact across its conversations)
- Produces (route):
  - `GET /api/conversation-index?days=N`. N is an integer ≥ 1; anything else means `60`.
  - It returns NDJSON frames: `{type:"progress", scanned, threads}`, `{type:"data", rows: ConversationRow[], days, from, truncated}` and `{type:"error", message}`.
  - `maxDuration = 300`, `runtime = "nodejs"`.
  - It pages `searchConversationsPage` sorted by last message, newest first, until the last message is older than the cutoff. `MAX_PAGES = 2000` is a runaway guard; hitting it sets `truncated: true`.
  - It fetches threads with concurrency 6.
  - Clients come from `requireClient()` + `withClient()` INSIDE `start()`.

- [ ] **Step 1: Write the failing tests** for the pure module:

```ts
check("toIso reads epoch number, numeric string and ISO", () => {
  assert.equal(toIso(1786082787710), new Date(1786082787710).toISOString());
  assert.equal(toIso("1786082787710"), new Date(1786082787710).toISOString());
  assert.equal(toIso(""), null);
});
check("a conversation ending outbound needs no thread; inbound inside the window does", () => {
  assert.equal(needsThread("outbound", NOW_ISO, CUTOFF), false);
  assert.equal(needsThread("inbound", NOW_ISO, CUTOFF), true);
  assert.equal(needsThread("inbound", OLD_ISO, CUTOFF), false);
});
check("last outbound skips activities and counts automated messages", () => {
  assert.equal(lastOutboundFrom([OUT_AUTOMATED_OCT20, ACTIVITY_OCT25, IN_OCT26]), OUT_AUTOMATED_OCT20.dateAdded);
});
check("contact dates take the max across conversations", () => { /* two rows same contact → max of each field */ });
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL.
- [ ] **Step 3: Implement** the module, `searchConversationsPage` and the route.
- [ ] **Step 4: Run** `pnpm verify:capabilities && npx tsc --noEmit`. Expected: ✓. Then check the route by hand, logged in locally as lezgo-suite (dev server on :3000, the session cookie in Playwright):
  - Run: `fetch('/api/conversation-index?days=7')` from the page.
  - Expected: progress frames, then a `data` frame with `rows.length > 0` and `truncated: false`.
- [ ] **Step 5: Commit** `feat(conversaciones): índice de conversaciones de solo lectura con último mensaje saliente por contacto`

---

### Task 8: Conversations in the panel — hook, source, contact message dates, pending state

**Files:**
- Create: `hooks/use-conversation-index.ts`
- Modify: `lib/widgets/semantic.ts`, `lib/widgets/engine.ts`, `lib/widgets/tools.ts`, `app/page.tsx`, `components/widgets/copilot-dock.tsx`
- Test: `scripts/verify-capabilities.ts` (`conversationsEngineSection`)

**Interfaces:**
- Consumes: `ConversationRow`, `contactMessageDates` (Task 7); `conversationDaysOf` (Task 1).
- Produces:
  - `export type ConversationState = { status: "idle" } | { status: "loading"; days: number; scanned: number; threads: number } | { status: "ready"; days: number; rows: ConversationRow[]; byContact: Map<string, ContactMessageDates>; truncated: boolean } | { status: "error"; days: number; message: string }` (in `lib/conversation-index.ts`).
  - `EngineContext.conversations?: ConversationState`.
  - `SOURCE_DEFS.conversations`:
    - `dateFields: ["lastMessageAt", "createdAt", "lastOutboundAt", "lastInboundAt"]` and `primaryDate: "lastMessageAt"`;
    - rows come from `ready` state only;
    - `NATIVE_FIELDS.conversations = ["channel", "assignedTo", "lastDirection", "unreadCount", "waitingReply", "lastMessageAt", "createdAt", "lastOutboundAt", "lastInboundAt"]`.
  - Contacts get the date fields `lastOutboundAt`, `lastInboundAt` and `lastMessageAt` from `byContact`. Other sources reach them as `contact.lastOutboundAt`.
    - A contact absent from `byContact` while state is `ready` is "beyond the window". In an age dimension it falls in key `"beyond"`, labelled `Más de <days> días o sin mensajes`.
    - `days_ago_gte N` matches it when `N ≤ days`. When `N > days` it does not match, and the card warns `No se puede medir más de <days> días con <days> días de conversaciones.`
  - `export function conversationDaysNeeded(q: QuerySpec): number | null` in `engine.ts`. It returns `conversationDaysOf(q)` when the query or any series uses source `conversations` or a contact message date (own or `contact.`), in groupBy, filters, fallbacks or time; otherwise `null`.
  - When needed and the state is not `ready` with `days >= needed`, `runQuery` returns `{ rows: [], totals: metrics.map(() => null), margins: null, compare: null, meta: { …, conversations: { status, days, scanned?, message? } } }`. It never returns measured zeros.
  - `meta.conversations` is also set when ready, with `{ status: "ready", days, truncated }`.
  - Warnings:
    - `Recomendamos limitar el periodo a 60 días o menos para reducir el tiempo de carga.` when `days > 60`.
    - `Mostrando los últimos <days> días de conversaciones.` when the source is `conversations` and the card's resolved range starts before `now − days` or is "todo".
  - `useConversationIndex(): { state: ConversationState; ensure(days: number): Promise<void>; retry(): void }`:
    - It loads `/api/conversation-index?days=<max requested>` through `hooks/fetch-stream.ts`.
    - It never reloads when a `ready` or `loading` state already covers the asked days.
    - The `ensure` promise settles when that load ends.
  - In `app/page.tsx`, an effect calls `ensure(max conversationDaysNeeded over the active tab's widgets)`, and `engineCtx.conversations` is set from the state.
  - `PanelToolDeps.ensureConversations?: (days: number) => Promise<void>`. `preview_widget`, `create_widgets`, `update_widget` and `get_widget_data` await it when `conversationDaysNeeded(spec.query)` is not null.
    - If it still errors, the tool returns `{ error: "No se pudieron cargar las conversaciones: <mensaje>" }`, which becomes `is_error`.

- [ ] **Step 1: Write the failing tests:**

```ts
check("pending conversations give a pending result, never zero rows", () => {
  const res = runQuery(convQuery, { ...ctx, conversations: { status: "loading", days: 60, scanned: 100, threads: 3 } });
  assert.equal(res.rows.length, 0);
  assert.deepEqual(res.totals, [null]);
  assert.equal(res.meta.conversations!.status, "loading");
});
check("stale matrix: open opps by stage age × our last outbound age", () => {
  const res = runQuery(staleMatrixQuery, readyCtx); // matrix, groupBy [lastStageChangeAt:age, contact.lastOutboundAt:age], filters outcome = Abierta, time ALL
  assert.equal(cell(res, "16–30 días", "Más de 60 días o sin mensajes"), 1); // a contact with no messages in the window
  assert.equal(cell(res, "0–7 días", "0–7 días"), 2);
});
check("panel range wider than window shows the window notice", () => {
  const res = runQuery({ ...convQuery, time: { ...convQuery.time, range: "all" } }, readyCtx);
  assert.ok(res.meta.warnings.includes("Mostrando los últimos 60 días de conversaciones."));
});
check("a widened window warns about load time", () => {
  const res = runQuery({ ...convQuery, conversationDays: 120 }, { ...readyCtx, conversations: { ...READY, days: 120 } });
  assert.ok(res.meta.warnings.includes("Recomendamos limitar el periodo a 60 días o menos para reducir el tiempo de carga."));
});
check("days_ago beyond the window does not match and warns", () => { /* days_ago_gte 90 with days 60 */ });
check("conversationDaysNeeded finds contact message dates in series and filters", () => {
  assert.equal(conversationDaysNeeded(staleMatrixQuery), 60);
  assert.equal(conversationDaysNeeded(q({})), null);
});
await checkAsync("preview of a conversations widget waits for the load", async () => {
  // makePanelHarness from verify-widgets with ensureConversations resolving to ready → preview returns rows
});
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL.
- [ ] **Step 3: Implement** the Produces block.
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:widgets && npx tsc --noEmit`. Expected: ✓.
- [ ] **Step 5: Commit** `feat(panel): conversaciones como fuente y fechas de mensajes del contacto, con carga bajo demanda`

---

### Task 9: Viz — matrix, multi-series, ratio KPI, outcome colors, card notices

**Files:**
- Create: `components/widgets/viz-matrix.tsx`
- Modify: `components/widgets/format.ts`, `viz-bar.tsx`, `viz-line.tsx`, `viz-table.tsx`, `viz-simple.tsx`, `widget-card.tsx`
- Verify: in the real app (Task 15). There are no unit tests for React components in this repo.

**Interfaces:**
- Consumes: `QueryResult.margins`, `meta.valueKind`, `meta.ratio`, `meta.seriesLabels`, `meta.undated`, `meta.conversations`, `meta.pipelineIgnored`, `QueryRow.parts` (Tasks 4–8).
- Produces:
  - `formatValue(value: number | null | undefined, kind: "count" | "amount" | "rate", currency?: string): string` and `formatTickKind(value: number, kind): string` in `format.ts`. The viz components use `meta.valueKind` when it is set, and `METRICS[metric].kind` otherwise.
  - Fixed colors in `colorForKey`: `Ganada` → the green, `Abierta` → slate blue, `Perdida` → red. Use the classic dashboards' won/lost tones from `dashboard-ui.tsx`, not new hexes. `(sin valor)`/`Sin fecha` and the `Más de … o sin mensajes` key get the muted grey.
  - `VizMatrix(props: VizProps)`:
    - rows = first dim and columns = second dim;
    - cells show metric 0, with a "Total" column and row from `margins` and the grand total from `totals[0]`;
    - heat is a background opacity scaled to the max cell, excluding `(sin valor)`/`Sin …` rows and columns;
    - clicking a cell drills its records; clicking a margin drills the union of that row or column;
    - it is wired in the card's viz switch for `"matrix"`.
  - Ratio rows: the tooltip shows `<pct> · X de Y` from `parts`. A KPI with `meta.ratio` shows the % big and `X de Y` beneath it.
  - Bars with series: grouped by default. `stacked_bar` stays only when validation allowed it.
  - `widget-card.tsx` notices:
    - `meta.conversations.status === "loading"` → muted Notice `Cargando conversaciones… (<scanned> revisadas)`, and no plot.
    - `"error"` → amber Notice with the message and a "Reintentar" button that calls the hook's `retry`. The card receives `onRetryConversations` from `app/page.tsx`.
    - `meta.undated` → the warning line is a button that opens the drill with those records.
    - `meta.pipelineIgnored` → its warning line is shown only while a pipeline filter is active (`ctx.pipelineFilter.length > 0`).

- [ ] **Step 1:** Implement `formatValue`/`formatTickKind` and switch the viz components to them.
- [ ] **Step 2:** Implement `VizMatrix` and wire it in.
- [ ] **Step 3:** Ratio tooltip and KPI; outcome and empty-key colors.
- [ ] **Step 4:** Card notices and retry.
- [ ] **Step 5: Run** `npx tsc --noEmit && pnpm lint`. Expected: no errors. Then open the pilot panel at `localhost:3000`. Expected: the existing widgets render exactly as before, compared against a screenshot taken before Step 1.
- [ ] **Step 6: Commit** `feat(panel): matriz, gráficas de varias series, KPI de proporción y avisos de carga`

---

### Task 10: Describe, labels and snapshot

**Files:**
- Modify: `lib/widgets/describe.ts`, `lib/widgets/labels.ts`
- Test: `scripts/verify-capabilities.ts` (`describeSection`)

**Interfaces:**
- Produces:
  - `describeWidget(spec)` and its card pill text name every series, the ratio type, the fallbacks, the age ranges and a conversation window other than 60. Expected strings are pinned below.
  - `describeFilterChips` renders `days_ago_*` as `hace ≥ N días` / `en los últimos N días`, and fallbacks as `A (o B)`.
  - `buildPanelSnapshot` renders a field-kind glossary entry as ` - «sucursal» (campo) = cf:Sucursal VAEO → cf:Sucursal MESH`.
  - `buildPanelCatalogSummary` adds two lines:
    - `Campos de fecha: <list with (contacto)/(oportunidad)>` when types are known, or `Campos de fecha personalizados: disponibles después de la próxima actualización` when not.
    - `Conversaciones: fuente «conversations» y fechas del contacto lastOutboundAt/lastInboundAt/lastMessageAt; se cargan bajo demanda (60 días por omisión).`

- [ ] **Step 1: Write the failing tests:**

```ts
check("series and ratio are described", () => {
  assert.equal(describeWidget(contactsVsOpps), "Contactos (por fecha de creación) y Oportunidades (por fecha de creación), por semana · periodo del panel");
  assert.match(describeWidget(shareSpec), /% con oportunidad = Con oportunidad ÷ Contactos \(mismo grupo, cuenta hasta hoy\)/);
  assert.match(describeWidget(betweenSpec), /cociente entre registros distintos/);
});
check("fallbacks and age ranges are described", () => {
  assert.match(describeWidget(bySucursal), /Sucursal VAEO \(o Sucursal MESH\)/);
  assert.match(describeWidget(staleMatrix), /días desde el último cambio de etapa × días desde nuestro último mensaje/);
});
check("the snapshot carries field-kind glossary entries", () => {
  assert.ok(buildPanelSnapshot(docWithSucursal, SNAPSHOT_STATE).includes(" - «sucursal» (campo) = cf:Sucursal VAEO → cf:Sucursal MESH"));
});
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:widgets && npx tsc --noEmit`. Expected: ✓.
- [ ] **Step 5: Commit** `feat(panel): la regla de cada tarjeta y el snapshot describen series, proporciones y campos combinados`

---

### Task 11: Glossary "campo" and `resolve_term` evidence for combined fields

**Files:**
- Modify: `lib/widgets/terms.ts`, `lib/widgets/doc-ops.ts`, `lib/widgets/tools.ts`
- Modify: `scripts/verify-widgets.ts` (strict-set pin 9 → 8)
- Test: `scripts/verify-capabilities.ts` (`glossaryFieldSection`)

**Interfaces:**
- Produces:
  - `TermCandidate.kind` adds `"combined_fields"` and `TermCandidate.fields?: string[]`. The candidate is added when ≥ 2 `field_name` candidates are found on the same entity, or on an opportunity plus its contact (`contact.` prefix). They also must be pairwise mostly disjoint: records with both filled ≤ 10% of the smaller filled count. Its `fields` are ordered by filled count, descending, and its `records` count is the union of filled records. `materiallyDifferent` is unchanged.
  - `saveTerm` accepts `kind: "field"` with `fields` and `meaning: []`.
  - The `save_term` tool:
    - adds `kind` (`"condition" | "field"`) and `fields` (string[] or null);
    - becomes **non-strict**, so the strict set is 8;
    - its executor validates with zod, `validateEntityField` for each field and `maxFallbacks`, and bad input goes back as `{ error }`.
  - `executePanelTool("save_term")` with `kind: "field"` writes the entry. A later widget gets `dimension = fields[0]` and `fallbacks = fields.slice(1)` expanded; this rule goes in the prompt (Task 13).

- [ ] **Step 1: Write the failing tests:**

```ts
check("two disjoint fields named after the concept become a combined candidate", () => {
  // fixture: 6 opps in pipeline VAEO fill "Sucursal VAEO", 4 in MESH fill "Sucursal MESH", none fill both
  const r = resolveTerm("sucursal", "opportunity", ctxSucursal);
  const comb = r.candidates.find((c) => c.kind === "combined_fields")!;
  assert.deepEqual(comb.fields, ["cf:Sucursal VAEO", "cf:Sucursal MESH"]);
  assert.equal(comb.records, 10);
});
check("overlapping fields do not combine", () => { /* both filled on 5 of 6 → no combined candidate */ });
await checkAsync("save_term kind field persists and is refused with an unknown field", async () => { /* harness: ok → doc.glossary[0].kind === "field"; bad field → result.error matches /no existe/ */ });
check("strict set is 8 tools without save_term", () => {
  assert.deepEqual(PANEL_TOOL_DEFINITIONS.filter((t) => t.strict).map((t) => t.name).sort(), ["arrange_tab", "delete_tab", "delete_widgets", "forget_term", "get_dashboard", "get_widget_data", "move_widgets", "upsert_tab"]);
});
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL.
- [ ] **Step 3: Implement**, and update the strict-set pin in `verify-widgets.ts` to the 8 names above.
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:widgets && npx tsc --noEmit`, then `pnpm check:strict-tools`. Expected: ✓, and the strict check reports the tools compiled (approved in the spec, ~$0.05).
- [ ] **Step 5: Commit** `feat(panel): conceptos de tipo campo en el glosario y evidencia de campos combinados`

---

### Task 12: Panel filter bar control on a combined field

**Files:**
- Modify: `lib/widgets/filter-state.ts`, `components/widgets/panel-filter-bar.tsx`, `components/widgets/filter-field-picker.tsx`, `lib/widgets/tools.ts` (`set_panel_filters` input accepts `fallbacks` on field controls)
- Test: `scripts/verify-capabilities.ts` (`filterBarSection`)

**Interfaces:**
- Consumes: `FilterControl.fallbacks` (Task 1), `fieldValuesWithFallbacks` (Task 3).
- Produces:
  - `activeGlobalFilters` builds `{ anyOf: [{ field, op: "in", values, fallbacks }] }` for a field control with fallbacks.
  - The bar's option list comes from `fieldValuesWithFallbacks` over the entity's records.
  - The field picker lists the doc's field-kind glossary entries as choices labelled with the term (e.g. "Sucursal"). Choosing one creates a control with `field = fields[0]` and `fallbacks = fields.slice(1)`.

- [ ] **Step 1: Write the failing tests:**

```ts
check("a combined-field control filters by first-filled value", () => {
  const ctrl: FilterControl = { id: "k1", kind: "field", entity: "opportunity", label: "Sucursal", field: "cf:Sucursal VAEO", fallbacks: ["cf:Sucursal MESH"], defaultValues: [], clause: null, defaultOn: false };
  const active = activeGlobalFilters(stateWith(ctrl, ["Valle"]), filtersWith(ctrl));
  const res = runQuery(q({ time: ALL }), { ...ctxSucursal, globalFilters: active });
  assert.deepEqual(ids(res), ["oMeshValle"]); // oBoth (VAEO=Tanarah, MESH=Valle) is NOT included
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:widgets && npx tsc --noEmit`. Expected: ✓.
- [ ] **Step 5: Commit** `feat(panel): control de la barra de filtros sobre un campo combinado`

---

### Task 13: Copilot prompt and tool descriptions

**Files:**
- Modify: `lib/ai-context.ts` (`PANEL_PROMPT_SECTION` only; `ASSISTANT_SYSTEM_PROMPT` must not change)
- Modify: `lib/widgets/tools.ts` (tool descriptions)
- Test: `scripts/verify-capabilities.ts` (`promptSection`) and the existing `buildChatRequest` equality check in `verify-widgets`

**Interfaces:**
- Produces these edits to `PANEL_PROMPT_SECTION`:
  1. **Rule 0** keeps "toda pregunta de datos termina en un widget **cuando se puede**".
  2. **New section "Cuando algo no se puede"**:
     - say in one sentence what can't be done and why, in business terms;
     - offer 1–3 buildable alternatives via `ask_user`;
     - build only the chosen one, never a substitute on your own;
     - before saying no, try series, ratios, fallbacks, custom dates, matrix and age.
  3. **"Qué gráfica elegir"**:
     - `matrix` for X × Y with totals;
     - series for several sources on one axis, grouped bars or lines, never stacked across sources;
     - a KPI with a ratio for "qué % …";
     - `outcome` for ganadas/abiertas/perdidas.
  4. **New "Proporciones"**:
     - "de los X, cuántos …" → same group (base + condition, counts to date);
     - "A entre B" with different sources → between series, and say in the reply that they are not the same records;
     - "tasa de citas como Ventas" → `appointment_rate`.
  5. **New "Fechas personalizadas"**:
     - only the fields listed as dates in the catalog;
     - for "ventas de octubre por Fecha de Cierre", set `time.field = "cf:Fecha de Cierre"`;
     - say how many are left out when the card warns.
  6. **New "Campos combinados"**:
     - when `resolve_term` returns `combined_fields`, ask once with `ask_user`;
     - save with `save_term kind:"field"`;
     - widgets use `dimension = fields[0]` and `fallbacks = the rest`, in groupBy AND filters.
  7. **New "Conversaciones"**:
     - source `conversations` and `contact.lastOutboundAt` etc.;
     - `conversationDays` stays null (60) unless the user explicitly asks for more;
     - when it is over 60, include in the reply: "Recomendamos limitar el periodo a 60 días o menos para reducir el tiempo de carga."
  8. **New "Días desde"**:
     - `bucket: "age"`, with the default edges;
     - "sin atención" = open opps, `lastStageChangeAt:age` × `contact.lastOutboundAt:age`, matrix, `range: "all"`;
     - the critical quadrant = a KPI with two `days_ago_gte` filters.

- [ ] **Step 1: Write the failing test:**

```ts
check("panel prompt carries the new sections and the dictated copy", () => {
  for (const h of ["## Cuando algo no se puede", "## Proporciones", "## Fechas personalizadas", "## Campos combinados", "## Conversaciones", "## Días desde"]) assert.ok(PANEL_PROMPT_SECTION.includes(h), h);
  assert.ok(PANEL_PROMPT_SECTION.includes("Recomendamos limitar el periodo a 60 días o menos para reducir el tiempo de carga."));
});
```

- [ ] **Step 2: Run** `pnpm verify:capabilities`. Expected: FAIL.
- [ ] **Step 3: Implement** the edits. Keep the existing numbered rules; they are regression fixes (CLAUDE.md).
- [ ] **Step 4: Run** `pnpm verify:capabilities && pnpm verify:widgets && npx tsc --noEmit`. Expected: ✓, including the assistant body equality.
- [ ] **Step 5: Commit** `feat(panel): el copiloto conoce series, proporciones, fechas, campos combinados y conversaciones, y dice que no ofreciendo lo más cercano`

---

### Task 14: Reference check against VAEO's logic on real caches

**Files:**
- Create: `scripts/check-vaeo-reference.ts`
- Modify: `package.json` (`"check:vaeo-reference": "tsx --env-file=.env.local scripts/check-vaeo-reference.ts"`)

**Interfaces:**
- Consumes: the engine (`runQuery`), `readSync`, `resolveClientById`.
- Produces: a read-only script.
  - Its reference implementations are ported from `DASHBOARDS_VAEO/lib/*` and must NOT import `lib/widgets/*`, because a check that imports the engine grades itself:
    1. **`statusByMonth(opps)`**: VAEO's `opportunity-status-chart` bucketing (ganada/abierta/perdida by month of `createdAt`).
    2. **`salesByDimension(opps, dateOf, dimOf)`**: VAEO's sales-by-dimension sum of `value` over won opps, with injected date and dimension accessors.
    3. **`staleBuckets(opps, lastOutboundByContact, now)`**: VAEO's stale-matrix bucketing, minus the conversations fetch.
  - Runs:
    - (1) on lezgo-suite, condesa-cimatario, stanza-residencial and rise-29;
    - (2) with `closedAt` as the date and a combined dimension: condesa "Canal de contacto" → contact "Canal de Contacto", stanza "Canal de Prospección del Lead" → "Canal de Prospección", rise-29 "Proyecto" → contact "Proyecto";
    - (3) on lezgo-suite, only with `--live`: it fetches the conversation index server-side through the same lib as the route, inside `withClient`.
  - Each run prints `✓ <cliente> <check> <n>/<n>` or the first mismatching cell, and exits 1 on any mismatch.

- [ ] **Step 1:** Write the script with the three references and the comparisons.
- [ ] **Step 2: Run** `pnpm check:vaeo-reference`. Expected: every line ✓. Any mismatch is investigated as a bug in the engine or in the port (superpowers:systematic-debugging), never "adjusted".
- [ ] **Step 3: Run** `pnpm check:vaeo-reference --live` (read-only GHL calls on lezgo-suite). Expected: ✓ for the stale matrix.
- [ ] **Step 4: Commit** `test(panel): comparación contra la lógica de VAEO sobre cachés reales`

---

### Task 15: Verify in the real app (lezgo-suite)

**Files:** none planned. Any fix found here gets its own failing test in `verify-capabilities.ts` first, then the fix, then a commit.

- [ ] **Step 1:** Restart the dev server and log in as lezgo-suite (the same local flow as the previous phase). Open the pilot panel. Expected: the saved panel opens unchanged (a v1 doc), with no console errors.
- [ ] **Step 2:** Ask the copilot `contactos y oportunidades creados por semana, en una sola gráfica para contrastar`. Expected: one widget with two series as grouped bars, and the pill describing both.
- [ ] **Step 3:** `oportunidades por estado por mes de creación`. Expected: a stacked bar in Ganada/Abierta/Perdida order with the fixed colors.
- [ ] **Step 4:** `de los contactos de cada semana, ¿qué % tiene oportunidad?`. Expected: a ratio chart in %, the "Cuenta hasta hoy…" note, and an `X de Y` tooltip.
- [ ] **Step 5:** `matriz de oportunidades por asesor y etapa`. Expected: a matrix with totals and heat; clicking a cell opens its records.
- [ ] **Step 6:** `oportunidades sin atención: días sin cambio de etapa contra días desde nuestro último mensaje`. Expected:
  - the "Cargando conversaciones…" notice, then a 5×5-plus matrix with the `Más de 60 días o sin mensajes` column;
  - with the panel on "Todo el historial", nothing reloads.
- [ ] **Step 7:** Something impossible, e.g. `una gráfica de dos ejes con contactos y valor ganado`. Expected: the copilot says no in one sentence and offers alternatives via `ask_user`. It builds only after a choice.
- [ ] **Step 8:** The Asistente IA tab: one question with a chart. Expected: unchanged (no `mode` in the body, `render_chart` works).
- [ ] **Step 9:** Record the results in the ledger. Fix anything found as above.

---

### Task 16: Eval corpus, docs

**Files:**
- Modify: `scripts/eval-panel/corpus.ts`
- Modify: `CLAUDE.md` (Commands: `verify:capabilities`, `check:vaeo-reference`; "AI-managed panel" section: the new capabilities, the invariants from Global Constraints, the strict set now 8, conversations not cached and loaded on demand)

**Interfaces:**
- Produces:
  - 12 new `EvalCase`s. At least one each for: series (the owner's prompt), same-group ratio, between-series ratio, custom date (on a client whose cache has a DATE field), combined field, outcome, matrix, age, conversations, stale matrix, and two "no + offer" cases.
  - Each has a `check` on the produced spec, e.g. `seriesOf(w.query).length === 1 && w.viz !== "stacked_bar"`, and a `reference` when the number is computable from plain arrays.

- [ ] **Step 1:** Add the cases and docs. Run `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 2:** Commit `docs(panel): capacidades nuevas del copiloto en CLAUDE.md y casos de evaluación`.
- [ ] **Step 3: STOP and ask the owner to approve the eval budget.** That is two accounts, ≈ $3–4 with the larger corpus. Only with approval, run `pnpm eval:panel lezgo-suite condesa-cimatario` and report the results by kind, including the "no + offer" cases.
