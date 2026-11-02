// Verification for lib/widgets/*. Run: pnpm verify:widgets
//
// Wrapped in main() rather than using top-level await: this package is CJS.
//
// The panel engine is where a silent bug becomes a wrong number on a client's
// screen — a widget that renders, looks plausible and describes a different
// population than its title claims. Same reason lib/ads.ts and
// lib/pipeline-filter.ts carry assertion scripts.
import assert from "node:assert/strict";
import {
  DOC_LIMITS,
  WIDGET_SPEC_JSON_SCHEMA,
  dashboardDocSchema,
  emptyDoc,
  parseDoc,
  widgetSpecObject,
  widgetSpecSchema,
  type DashboardDoc,
  type WidgetSpec,
} from "../lib/widgets/spec";
import { sourceCategory } from "../lib/source-platform";
import { rankPautasByContact } from "../lib/pauta";
import type { AdsReport, Appointment, Contact, Opportunity, Pauta, Pipeline } from "../lib/types";
import { executeTool, type ChatDataset } from "../lib/ai-tools";
import {
  dimensionValues,
  funnelState,
  knownCustomFields,
  listFieldValues,
  matchesClause,
  matchesFilter,
  resolveCtx,
  type EngineContext,
} from "../lib/widgets/semantic";
import { METRICS, metricAllowed, type MetricCtx } from "../lib/widgets/metrics";
import { runQuery, type QueryResult } from "../lib/widgets/engine";
import { buildCatalog, validateWidget } from "../lib/widgets/validate";
import { PANEL_SNAPSHOT_MARKER, buildPanelCatalogSummary, buildPanelSnapshot, describeFilterChips, describeWidget } from "../lib/widgets/describe";
import { resolveTerm, termRoots } from "../lib/widgets/terms";
import {
  DocOpError,
  addWidgets,
  arrangeTab,
  deleteTab,
  deleteWidgets,
  forgetTerm,
  moveWidgets,
  saveTerm,
  setPanelFilters,
  updateWidget,
  upsertTab,
  type OpMeta,
} from "../lib/widgets/doc-ops";
import { buildSuggestions } from "../lib/widgets/suggestions";
import { panelSettled, withRetry } from "../hooks/use-dashboard-doc";
import { docProblem } from "../lib/widgets/spec";
import { PANEL_MODE_TOOLS, PANEL_TOOL_DEFINITIONS, executePanelTool, type PanelToolDeps } from "../lib/widgets/tools";
import { buildChatRequest } from "../lib/chat-request";
import { TOOL_DEFINITIONS } from "../lib/ai-tools";
import { ASSISTANT_SYSTEM_PROMPT, PANEL_PROMPT_SECTION } from "../lib/ai-context";
import type { PanelFilterState } from "../lib/widgets/filter-state";
import { activeGlobalFilters, describeFilterState, initialFilterState, stateAsDefaults, staleValues } from "../lib/widgets/filter-state";
import type { FilterControl, PanelFilters } from "../lib/widgets/spec";
import { QueryError, type ActiveGlobalFilter } from "../lib/widgets/semantic";
import type { QuerySpec } from "../lib/widgets/spec";
import { section, check, checkAsync, mkContact, mkOpp, mkAppt, makeFixture, q, dim, byLabel, ids, type Fixture } from "./lib/widget-test-kit";


// ─── Shared spec fixtures ─────────────────────────────────────────────────────

// The owner's example: appointments grouped by the stage of the contact's
// most recent opportunity.
function apptsByStageSpec(): WidgetSpec {
  return {
    title: "Citas por etapa",
    subtitle: null,
    viz: "bar",
    size: "m",
    height: "normal",
    query: {
      source: "appointments",
      metrics: [{ metric: "count", label: null }],
      groupBy: [{ dimension: "opportunity.stage", bucket: null, join: "latest" }],
      filters: [],
      relatedFilters: [],
      time: { field: "startTime", range: "inherit", from: null, to: null, compare: "none" },
      globalFilters: "inherit",
      sort: { by: "value", dir: "desc" },
      limit: null,
    },
    text: null,
    target: null,
    nativeId: null,
    prompt: "las citas organizadas por etapa del pipeline",
  };
}

function lostContactsSpec(): WidgetSpec {
  const base = apptsByStageSpec();
  return {
    ...base,
    title: "Contactos con negocio perdido",
    viz: "record_list",
    query: {
      ...base.query!,
      source: "contacts",
      groupBy: [],
      relatedFilters: [
        {
          entity: "opportunity",
          quantifier: "any",
          conditions: [
            {
              anyOf: [
                { field: "status", op: "eq", values: ["lost"] },
                { field: "stage", op: "in", values: ["Negocio Perdido"] },
              ],
            },
          ],
        },
      ],
      time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" },
      limit: 25,
    },
  };
}

const rejects = (spec: unknown): boolean => !widgetSpecSchema.safeParse(spec).success;

// ─── Sections ─────────────────────────────────────────────────────────────────

function specSection(): void {
  section("spec");

  check("acepta el spec de citas por etapa (join latest)", () => {
    assert.doesNotThrow(() => widgetSpecSchema.parse(apptsByStageSpec()));
  });

  check("acepta contactos con negocio perdido (cláusula OR estado/etapa)", () => {
    assert.doesNotThrow(() => widgetSpecSchema.parse(lostContactsSpec()));
  });

  check("rechaza 0 y 4 métricas", () => {
    const s = apptsByStageSpec();
    assert.ok(rejects({ ...s, query: { ...s.query!, metrics: [] } }));
    const four = Array.from({ length: 4 }, () => ({ metric: "count", label: null }));
    assert.ok(rejects({ ...s, query: { ...s.query!, metrics: four } }));
  });

  check("rechaza 3 dimensiones, limit 51 y título de 81 caracteres", () => {
    const s = apptsByStageSpec();
    const g = { dimension: "stage", bucket: null, join: null };
    assert.ok(rejects({ ...s, query: { ...s.query!, groupBy: [g, g, g] } }));
    assert.ok(rejects({ ...s, query: { ...s.query!, limit: 51 } }));
    assert.ok(rejects({ ...s, title: "x".repeat(81) }));
  });

  check("rechaza 5 relatedFilters y 6 cláusulas en conditions", () => {
    const s = lostContactsSpec();
    const rf = s.query!.relatedFilters[0];
    assert.ok(rejects({ ...s, query: { ...s.query!, relatedFilters: [rf, rf, rf, rf, rf] } }));
    const clause = rf.conditions[0];
    const six = Array.from({ length: 6 }, () => clause);
    assert.ok(rejects({ ...s, query: { ...s.query!, relatedFilters: [{ ...rf, conditions: six }] } }));
  });

  check("rechaza una cláusula vacía y una con 6 condiciones", () => {
    const s = apptsByStageSpec();
    assert.ok(rejects({ ...s, query: { ...s.query!, filters: [{ anyOf: [] }] } }));
    const cond = { field: "status", op: "eq", values: ["showed"] };
    const six = Array.from({ length: 6 }, () => cond);
    assert.ok(rejects({ ...s, query: { ...s.query!, filters: [{ anyOf: six }] } }));
  });

  check("viz text exige query null y text; los demás exigen query", () => {
    const s = apptsByStageSpec();
    assert.ok(rejects({ ...s, viz: "text", text: "Meta del mes" }));
    assert.ok(rejects({ ...s, viz: "text", query: null, text: null }));
    assert.doesNotThrow(() => widgetSpecSchema.parse({ ...s, viz: "text", query: null, text: "Meta del mes" }));
    assert.ok(rejects({ ...s, query: null }));
  });

  check("doc: rechaza 9 controles y controles incoherentes con su kind", () => {
    const field = {
      id: "f1",
      kind: "field",
      entity: "opportunity",
      label: "Asesor",
      field: "assignedTo",
      defaultValues: [],
      clause: null,
      defaultOn: false,
    };
    const withControls = (controls: unknown[]): unknown => ({
      ...emptyDoc(),
      filters: { defaultDate: null, defaultPipelines: [], controls },
    });
    assert.ok(dashboardDocSchema.safeParse(withControls([field])).success);
    const nine = Array.from({ length: DOC_LIMITS.maxControls + 1 }, (_, i) => ({ ...field, id: `f${i}` }));
    assert.equal(dashboardDocSchema.safeParse(withControls(nine)).success, false);
    assert.equal(dashboardDocSchema.safeParse(withControls([{ ...field, field: null }])).success, false);
    const cond = { ...field, kind: "condition", field: null, clause: null };
    assert.equal(dashboardDocSchema.safeParse(withControls([cond])).success, false);
  });

  check("JSON Schema estricto: additionalProperties false y required completo en cada objeto", () => {
    const visit = (node: unknown, path: string): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach((n, i) => visit(n, `${path}[${i}]`));
        return;
      }
      const o = node as Record<string, unknown>;
      if (o.type === "object" || (Array.isArray(o.type) && o.type.includes("object"))) {
        assert.equal(o.additionalProperties, false, `${path}: additionalProperties`);
        const props = Object.keys((o.properties as Record<string, unknown>) ?? {});
        const required = (o.required as string[]) ?? [];
        assert.deepEqual([...required].sort(), [...props].sort(), `${path}: required`);
      }
      for (const [k, v] of Object.entries(o)) visit(v, `${path}.${k}`);
    };
    visit(WIDGET_SPEC_JSON_SCHEMA, "$");
  });

  check("JSON Schema y zod tienen las mismas claves de nivel superior", () => {
    const jsonKeys = Object.keys(WIDGET_SPEC_JSON_SCHEMA.properties as Record<string, unknown>).sort();
    const zodKeys = Object.keys(widgetSpecObject.shape).sort();
    assert.deepEqual(jsonKeys, zodKeys);
  });

  check("parseDoc: ida y vuelta del doc vacío; sin schemaVersion lanza", () => {
    const doc: DashboardDoc = emptyDoc();
    assert.deepEqual(parseDoc(JSON.parse(JSON.stringify(doc))), doc);
    assert.throws(() => parseDoc({ tabs: [] }));
    assert.throws(() => parseDoc({ ...doc, schemaVersion: 2 }));
  });
}

function domainSection(): void {
  section("domain");

  const opp = (o: Partial<Opportunity>): Opportunity =>
    ({ id: "o", name: "o", pipelineId: "p", pipelineStageId: "s", status: "open", createdAt: "2026-01-01", contactId: "c", value: 0, stage: "Nuevo", pipelineName: "P", ...o }) as Opportunity;

  check("sourceCategory: facebook → Paid Social, vacío → CRM UI, Tipo de pauta Google Ads → Paid Search", () => {
    assert.equal(sourceCategory(opp({ source: "facebook", adType: "paid_social" })), "Paid Social");
    assert.equal(sourceCategory(opp({ source: "" })), "CRM UI");
    assert.equal(
      sourceCategory(opp({ source: "Third Party", adType: "zapier", customFieldsResolved: { "Tipo de pauta": "Google Ads" } })),
      "Paid Search"
    );
  });

  check("rankPautasByContact: orden cronológico por contacto; sin contacto no entra", () => {
    const p = (id: string, createdAt: string, contactId?: string): Pauta => ({ id, tipo: "", nombrePauta: "", createdAt, contactId });
    const ranks = rankPautasByContact([
      p("b", "2026-03-10T00:00:00Z", "c1"),
      p("a", "2026-01-05T00:00:00Z", "c1"),
      p("c", "2026-07-01T00:00:00Z", "c1"),
      p("x", "2026-02-01T00:00:00Z"),
    ]);
    assert.equal(ranks.get("a"), 0);
    assert.equal(ranks.get("b"), 1);
    assert.equal(ranks.get("c"), 2);
    assert.equal(ranks.has("x"), false);
  });
}


// ─── Shared dataset fixture (Tasks 3–8) ───────────────────────────────────────


function semanticSection(): void {
  section("semantic");
  const { ctx, c, o } = makeFixture();
  const r = resolveCtx(ctx);
  const row = (x: object) => x as unknown as Record<string, unknown>;

  check("cf multiopción se despliega; tags vacíos → (sin tag)", () => {
    assert.deepEqual(dimensionValues("contacts", row(c.c1), "cf:Origen de Lead", r), ["Facebook", "Instagram"]);
    assert.deepEqual(dimensionValues("contacts", row(c.c2), "tags", r), ["(sin tag)"]);
  });

  check("funnelState: ganada por etapa → Ganado; lost → Perdido", () => {
    assert.equal(funnelState(o.o3), "Ganado");
    assert.equal(funnelState(o.o4), "Perdido");
  });

  check("matchesFilter: cf in (sin mayúsculas) e is_empty", () => {
    assert.equal(matchesFilter("contacts", row(c.c1), { field: "cf:Origen de Lead", op: "in", values: ["instagram"] }, r), true);
    assert.equal(matchesFilter("contacts", row(c.c2), { field: "cf:Origen de Lead", op: "is_empty", values: [] }, r), true);
  });

  check("knownCustomFields y listFieldValues", () => {
    assert.ok(knownCustomFields("contacts", r).has("Origen de Lead"));
    assert.ok(listFieldValues("opportunity", "stage", r).some((v) => v.value === "Propuesta" && v.count === 1));
  });

  check("won derivado: o3 (por etapa) → true, o1 → false", () => {
    assert.deepEqual(dimensionValues("opportunities", row(o.o3), "won", r), ["true"]);
    assert.deepEqual(dimensionValues("opportunities", row(o.o1), "won", r), ["false"]);
  });

  check("matchesClause: OR entre campos distintos", () => {
    const clause = { anyOf: [{ field: "status", op: "eq" as const, values: ["lost"] }, { field: "stage", op: "in" as const, values: ["Propuesta"] }] };
    assert.equal(matchesClause("opportunities", row(o.o4), clause, r), true);
    assert.equal(matchesClause("opportunities", row(o.o2), clause, r), true);
    assert.equal(matchesClause("opportunities", row(o.o1), clause, r), false);
  });
}

function metricsSection(): void {
  section("metrics");
  const { ctx } = makeFixture();
  const r = resolveCtx(ctx);
  const rows = (a: readonly object[]) => a as unknown as Record<string, unknown>[];
  const mctx = (source: MetricCtx["source"], range: MetricCtx["range"] = null): MetricCtx => ({ ...r, source, range });
  const opps = rows(ctx.dataset.opportunities);

  check("won_count = 1 (o3 ganada por etapa); win_rate 0.25; won_value 1000", () => {
    assert.equal(METRICS.won_count.compute(opps, mctx("opportunities")), 1);
    assert.equal(METRICS.win_rate.compute(opps, mctx("opportunities")), 0.25);
    assert.equal(METRICS.won_value.compute(opps, mctx("opportunities")), 1000);
  });

  check("show_rate de las 4 citas = 0.5", () => {
    assert.equal(METRICS.show_rate.compute(rows(ctx.dataset.appointments), mctx("appointments")), 0.5);
  });

  check("leads_pauta_unique = 2 (p-a y p-c); leads_pauta_opps = 2 (o1, o2)", () => {
    assert.equal(METRICS.leads_pauta_unique.compute(rows(ctx.dataset.pautas), mctx("pautas")), 2);
    assert.equal(METRICS.leads_pauta_opps.compute(opps, mctx("opportunities")), 2);
  });

  check("appointment_rate con rango octubre = 0.5 (o1 y o2 tienen citas de c1)", () => {
    const october = { from: new Date(2026, 9, 1, 0, 0, 0), to: new Date(2026, 9, 31, 23, 59, 59) };
    assert.equal(METRICS.appointment_rate.compute(opps, mctx("opportunities", october)), 0.5);
  });

  check("razón con denominador 0 → null; metricAllowed respeta fuentes", () => {
    assert.equal(METRICS.win_rate.compute([], mctx("opportunities")), null);
    assert.equal(metricAllowed("show_rate", "opportunities"), false);
    assert.equal(metricAllowed("show_rate", "appointments"), true);
  });
}


// Cross-object fixture: what "perdido" means is NOT known to the engine — each
// reading is just a clause.
function makeLostFixture(): EngineContext {
  const k = ["k1", "k2", "k3", "k4"].map((id) => mkContact(id));
  const opps = [
    mkOpp("q1", "k1", "A", "Calificado", "2026-10-01T12:00:00Z", { status: "lost" }),
    mkOpp("q2", "k1", "B", "Propuesta", "2026-10-02T12:00:00Z"),
    mkOpp("q3", "k2", "A", "Negocio Perdido", "2026-10-03T12:00:00Z", { assignedTo: "Ana" }),
    mkOpp("q4", "k3", "A", "Propuesta", "2026-10-04T12:00:00Z"),
  ];
  return {
    dataset: {
      contacts: k,
      opportunities: opps,
      pautas: [{ id: "px", tipo: "", nombrePauta: "", createdAt: "2026-10-05T12:00:00Z" }],
      appointments: [],
      messages: [],
      tasks: [],
      calls: [],
    },
    pipelines: [
      { id: "A", name: "A", stages: ["Calificado", "Propuesta", "Negocio Perdido"] },
      { id: "B", name: "B", stages: ["Propuesta"] },
    ],
    ads: undefined,
    dateRange: null,
    pipelineFilter: [],
    globalFilters: [],
    now: new Date(2026, 9, 29, 12, 0, 0),
  };
}

function engineSection(): void {
  section("engine");
  const { ctx } = makeFixture();

  check("funnelState con orden natural", () => {
    const res = runQuery(q({ groupBy: [dim("funnelState")], sort: { by: "natural", dir: "asc" } }), ctx);
    assert.deepEqual(res.rows.map((r) => r.label[0]), ["Primera Cita", "Propuesta", "Ganado", "Perdido"]);
  });

  check("buckets por mes con rango all", () => {
    const res = runQuery(q({ groupBy: [dim("createdAt", "month")], sort: { by: "natural", dir: "asc" }, time: { field: "createdAt", range: "all", from: null, to: null, compare: "none" } }), ctx);
    assert.deepEqual(res.rows.map((r) => [r.key[0], r.values[0]]), [["2026-09", 1], ["2026-10", 3]]);
  });

  check("last_30d → 3 oportunidades (o2, o3, o4)", () => {
    const res = runQuery(q({ time: { field: "createdAt", range: "last_30d", from: null, to: null, compare: "none" } }), ctx);
    assert.equal(res.meta.recordCount, 3);
  });

  check("fecha secundaria closedAt: last_30d → solo o3; all → las 4", () => {
    const last30 = runQuery(q({ time: { field: "closedAt", range: "last_30d", from: null, to: null, compare: "none" } }), ctx);
    assert.deepEqual(ids(last30), ["o3"]);
    const all = runQuery(q({ time: { field: "closedAt", range: "all", from: null, to: null, compare: "none" } }), ctx);
    assert.equal(all.meta.recordCount, 4);
  });

  check("limit 2 con plegado: 3 filas, la última Otros, 2 grupos plegados; razón recalculada", () => {
    const res = runQuery(q({ groupBy: [dim("stage")], metrics: [{ metric: "count", label: null }, { metric: "win_rate", label: null }], limit: 2 }), ctx);
    assert.equal(res.rows.length, 3);
    const otros = res.rows[2];
    assert.equal(otros.label[0], "Otros");
    assert.equal(res.meta.foldedIntoOtros, 2);
    assert.equal(otros.values[1], METRICS.win_rate.compute(otros.records, { ...resolveCtx(ctx), source: "opportunities", range: null }));
  });

  check("pipeline p2 sobre citas → solo citas de c1", () => {
    const res = runQuery(q({ source: "appointments", groupBy: [dim("status")], time: { field: "startTime", range: "inherit", from: null, to: null, compare: "none" } }), { ...ctx, pipelineFilter: ["p2"] });
    assert.deepEqual(ids(res), ["a1", "a2", "a3"]);
  });

  const lost = makeLostFixture();
  const contactsWith = (related: QuerySpec["relatedFilters"], over: Partial<EngineContext> = {}) =>
    ids(runQuery(q({ source: "contacts", relatedFilters: related }), { ...lost, ...over }));
  const byStatus = { anyOf: [{ field: "status", op: "eq" as const, values: ["lost"] }] };
  const byStage = { anyOf: [{ field: "stage", op: "in" as const, values: ["Negocio Perdido"] }] };
  const either = { anyOf: [...byStatus.anyOf, ...byStage.anyOf] };

  check("contactos con negocio perdido: cada lectura es solo una cláusula", () => {
    assert.deepEqual(contactsWith([{ entity: "opportunity", quantifier: "any", conditions: [byStatus] }]), ["k1"]);
    assert.deepEqual(contactsWith([{ entity: "opportunity", quantifier: "any", conditions: [byStage] }]), ["k2"]);
    assert.deepEqual(contactsWith([{ entity: "opportunity", quantifier: "any", conditions: [either] }]), ["k1", "k2"]);
  });

  check("quantifier none → contactos sin oportunidad perdida (k3, k4)", () => {
    assert.deepEqual(contactsWith([{ entity: "opportunity", quantifier: "none", conditions: [either] }]), ["k3", "k4"]);
  });

  check("las cláusulas se cumplen en el MISMO registro relacionado", () => {
    const inB = { anyOf: [{ field: "pipelineName", op: "eq" as const, values: ["B"] }] };
    assert.deepEqual(contactsWith([{ entity: "opportunity", quantifier: "any", conditions: [byStatus, inB] }]), []);
  });

  const ana: ActiveGlobalFilter = { entity: "opportunity", label: "Asesor", clause: { anyOf: [{ field: "assignedTo", op: "in", values: ["Ana"] }] } };

  check("global de asesor sobre contactos → solo k2; con ignore no aplica", () => {
    assert.deepEqual(ids(runQuery(q({ source: "contacts" }), { ...lost, globalFilters: [ana] })), ["k2"]);
    assert.equal(runQuery(q({ source: "contacts", globalFilters: "ignore" }), { ...lost, globalFilters: [ana] }).meta.recordCount, 4);
  });

  check("el filtro propio del widget gana sobre el global del mismo campo", () => {
    const res = runQuery(
      q({ filters: [{ anyOf: [{ field: "pipelineName", op: "eq", values: ["B"] }] }] }),
      { ...lost, pipelineFilter: ["A"] }
    );
    assert.deepEqual(ids(res), ["q2"]);
    assert.ok(res.meta.overriddenGlobals.includes("pipeline"));
  });

  check("filas sin contacto se excluyen con un filtro entre objetos activo", () => {
    const res = runQuery(q({ source: "pautas", relatedFilters: [{ entity: "opportunity", quantifier: "none", conditions: [] }], time: { field: "createdAt", range: "all", from: null, to: null, compare: "none" } }), lost);
    assert.equal(res.meta.recordCount, 0);
  });

  check("un campo personalizado borrado lanza QueryError unknown_field", () => {
    assert.throws(
      () => runQuery(q({ source: "contacts", filters: [{ anyOf: [{ field: "cf:Campo Borrado", op: "in", values: ["x"] }] }] }), ctx),
      (err: unknown) => err instanceof QueryError && err.code === "unknown_field"
    );
  });

  check("bucket diario sobre años sube a semana con una advertencia", () => {
    const contacts: Contact[] = [];
    for (let d = new Date(2023, 0, 1, 12); d <= new Date(2026, 9, 29, 12); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12)) {
      contacts.push(mkContact(`s${contacts.length}`, { createdAt: d.toISOString() }));
    }
    const big = { ...ctx, dataset: { ...ctx.dataset, contacts } };
    const res = runQuery(q({ source: "contacts", groupBy: [dim("createdAt", "day")], sort: { by: "natural", dir: "asc" }, time: { field: "createdAt", range: "all", from: null, to: null, compare: "none" } }), big);
    assert.equal(res.meta.bucketUsed, "week");
    assert.ok(res.rows.length <= 366);
    assert.equal(res.meta.warnings.length, 1);
  });

  check("un mes sin oportunidades dentro del rango: win_rate null, conteo 0", () => {
    const res = runQuery(
      q({ groupBy: [dim("createdAt", "month")], metrics: [{ metric: "count", label: null }, { metric: "win_rate", label: null }], sort: { by: "natural", dir: "asc" }, time: { field: "createdAt", range: "absolute", from: "2026-08-01", to: "2026-10-31", compare: "none" } }),
      ctx
    );
    const aug = res.rows.find((r) => r.key[0] === "2026-08")!;
    assert.equal(aug.values[0], 0);
    assert.equal(aug.values[1], null);
  });

  check("citas fuera de ±90 días → advertencia; last_30d → sin ella", () => {
    const wide = runQuery(q({ source: "appointments", time: { field: "startTime", range: "absolute", from: "2026-01-01", to: "2026-10-29", compare: "none" } }), ctx);
    assert.ok(wide.meta.warnings.some((w) => w.includes("solo cubren 90 días")));
    const narrow = runQuery(q({ source: "appointments", time: { field: "startTime", range: "last_30d", from: null, to: null, compare: "none" } }), ctx);
    assert.ok(!narrow.meta.warnings.some((w) => w.includes("solo cubren 90 días")));
  });

  check("byLabel helper sanity (sin grupos → una fila con los totales)", () => {
    const res = runQuery(q({}), ctx);
    assert.equal(res.rows.length, 1);
    assert.deepEqual(byLabel(res), { "": 4 });
  });
}

function joinSection(): void {
  section("join");
  const { ctx } = makeFixture();
  const appts = (over: Partial<QuerySpec>, c: EngineContext = ctx) =>
    runQuery(q({ source: "appointments", time: { field: "startTime", range: "inherit", from: null, to: null, compare: "none" }, ...over }), c);

  check("citas por opportunity.stage (latest) → Propuesta 3, Sin oportunidad 1; suma = total", () => {
    const res = appts({ groupBy: [dim("opportunity.stage", null, "latest")] });
    assert.deepEqual(byLabel(res), { Propuesta: 3, "Sin oportunidad": 1 });
    assert.equal(res.rows.reduce((acc, r) => acc + (r.values[0] ?? 0), 0), res.meta.recordCount);
  });

  check("con pipeline p1 → Primera Cita 3 (la más reciente de c1 dentro de p1 es o1)", () => {
    const res = appts({ groupBy: [dim("opportunity.stage", null, "latest")] }, { ...ctx, pipelineFilter: ["p1"] });
    assert.deepEqual(byLabel(res), { "Primera Cita": 3 });
  });

  check("join each → cada cita una vez por oportunidad; fanOut", () => {
    const res = appts({ groupBy: [dim("opportunity.stage", null, "each")] });
    assert.deepEqual(byLabel(res), { "Primera Cita": 3, Propuesta: 3, "Sin oportunidad": 1 });
    assert.equal(res.meta.fanOut, true);
  });

  check("global de etapa sobre la oportunidad: candidatos = los que pasan el filtro", () => {
    const g: ActiveGlobalFilter = { entity: "opportunity", label: "Etapa", clause: { anyOf: [{ field: "stage", op: "in", values: ["Primera Cita"] }] } };
    const res = appts({ groupBy: [dim("opportunity.stage", null, "latest")] }, { ...ctx, globalFilters: [g] });
    assert.deepEqual(byLabel(res), { "Primera Cita": 3 });
  });

  check("opps por contact.cf:Origen de Lead → o1 y o2 en Facebook e Instagram; o3, o4 sin valor", () => {
    const res = runQuery(q({ groupBy: [dim("contact.cf:Origen de Lead")] }), ctx);
    assert.deepEqual(byLabel(res), { Facebook: 2, Instagram: 2, "(sin valor)": 2 });
  });
}

function makeAdsFixture(ads: AdsReport | undefined): EngineContext {
  const base = makeFixture().ctx;
  const daily = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, "0")}`,
    spend: 100, impressions: 1000, clicks: 10, reach: 500, metaLeads: 0, conversations: 0,
  }));
  return {
    ...base,
    ads: ads === undefined ? undefined : { ...ads, daily: ads.status === "connected" ? daily : [] },
    dataset: {
      ...base.dataset,
      contacts: [mkContact("z1", { createdAt: "2026-10-05T12:00:00Z" }), mkContact("z2", { createdAt: "2026-10-06T12:00:00Z" })],
      opportunities: [
        mkOpp("m1", "z1", "p1", "Nuevo", "2026-10-06T12:00:00Z", { source: "facebook" }),
        mkOpp("m2", "z2", "p2", "Nuevo", "2026-10-08T12:00:00Z", { source: "facebook" }),
      ],
      pautas: [],
      appointments: [],
    },
  };
}

function adsSection(): void {
  section("ads");
  const connected: AdsReport = { status: "connected", currency: "MXN", from: "2026-10-01", to: "2026-10-10", daily: [] };
  const adsQ = (metric: QuerySpec["metrics"][number]["metric"], over: Partial<QuerySpec> = {}) =>
    q({ source: "ads_daily", metrics: [{ metric, label: null }], time: { field: "date", range: "all", from: null, to: null, compare: "none" }, ...over });
  const ctx = makeAdsFixture(connected);

  check("spend con rango all = 600 (recortado desde el primer día del CRM, 2026-10-05)", () => {
    assert.equal(runQuery(adsQ("spend"), ctx).totals[0], 600);
  });

  check("cpl = 600 ÷ 2 leads de pauta = 300; ctr = clics ÷ impresiones", () => {
    assert.equal(runQuery(adsQ("cpl"), ctx).totals[0], 300);
    assert.equal(runQuery(adsQ("ctr"), ctx).totals[0], 0.01);
  });

  check("cpl por día: gasto del día ÷ leads de ese día; sin leads → null", () => {
    const res = runQuery(adsQ("cpl", { groupBy: [dim("date", "day")], sort: { by: "natural", dir: "asc" } }), ctx);
    const byKey = Object.fromEntries(res.rows.map((r) => [r.key[0], r.values[0]]));
    assert.equal(byKey["2026-10-06"], 100);
    assert.equal(byKey["2026-10-07"], null);
  });

  check("sin ads (payload viejo) → pending; desconectado → su estado y mensaje, totales null", () => {
    const pending = runQuery(adsQ("spend"), makeAdsFixture(undefined));
    assert.equal(pending.meta.adsStatus, "pending");
    assert.equal(pending.rows.length, 0);
    const disc = runQuery(adsQ("spend"), makeAdsFixture({ status: "disconnected", message: "Vincula tu cuenta de Meta", daily: [] }));
    assert.equal(disc.meta.adsStatus, "disconnected");
    assert.equal(disc.meta.adsMessage, "Vincula tu cuenta de Meta");
    assert.equal(disc.totals[0], null);
  });

  check("Meta ignora los filtros de CRM (pipeline y globales)", () => {
    const ana: ActiveGlobalFilter = { entity: "opportunity", label: "Asesor", clause: { anyOf: [{ field: "assignedTo", op: "in", values: ["Ana"] }] } };
    const res = runQuery(adsQ("cpl"), { ...ctx, pipelineFilter: ["p2"], globalFilters: [ana] });
    assert.equal(res.totals[0], 300);
    assert.equal(res.meta.crmFiltersIgnored, true);
  });

  check("ventana recortada → advertencia con las fechas reales", () => {
    const res = runQuery(adsQ("spend"), ctx);
    assert.ok(res.meta.warnings.some((w) => w.includes("El gasto solo cubre del 2026-10-05")));
  });
}

function compareSection(): void {
  section("compare");
  const { ctx } = makeFixture();

  check("previous_period de octubre = 31 ago–30 sep → 1 oportunidad (o1)", () => {
    const res = runQuery(q({ time: { field: "createdAt", range: "absolute", from: "2026-10-01", to: "2026-10-31", compare: "previous_period" } }), ctx);
    assert.ok(res.compare);
    assert.equal(res.compare!.totals[0], 1);
    assert.deepEqual(res.compare!.range, { from: "2026-08-31", to: "2026-09-30" });
  });

  check("sin periodo (Todo el historial) → compare null con advertencia", () => {
    const res = runQuery(q({ time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "previous_period" } }), { ...ctx, dateRange: null });
    assert.equal(res.compare, null);
    assert.ok(res.meta.warnings.includes("Sin periodo anterior: el filtro es «Todo el historial»"));
  });

  check("con dimensiones no hay comparación", () => {
    const res = runQuery(q({ groupBy: [dim("stage")], time: { field: "createdAt", range: "absolute", from: "2026-10-01", to: "2026-10-31", compare: "previous_period" } }), ctx);
    assert.equal(res.compare, null);
  });
}

function validateSection(): void {
  section("validate");
  const { ctx } = makeFixture();
  const catalog = buildCatalog(ctx);
  const base = apptsByStageSpec();
  const withQuery = (over: Partial<QuerySpec>, viz: WidgetSpec["viz"] = base.viz): WidgetSpec => ({ ...base, viz, query: { ...base.query!, ...over } });

  check("cf:Origen → sugiere cf:Origen de Lead", () => {
    const issues = validateWidget(withQuery({ source: "contacts", groupBy: [dim("cf:Origen")], time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" } }), catalog);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].suggestion, "cf:Origen de Lead");
  });

  check("line sin dimensión de fecha → issue en viz", () => {
    const issues = validateWidget(withQuery({ source: "opportunities", groupBy: [dim("stage")], time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" } }, "line"), catalog);
    assert.ok(issues.some((i) => i.path === "viz"));
  });

  check("show_rate sobre oportunidades → issue", () => {
    const issues = validateWidget(withQuery({ source: "opportunities", groupBy: [], metrics: [{ metric: "show_rate", label: null }], time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" } }, "kpi"), catalog);
    assert.equal(issues.length, 1);
  });

  check("el ejemplo del dueño y contactos con negocio perdido son válidos", () => {
    assert.deepEqual(validateWidget(base, catalog), []);
    assert.deepEqual(validateWidget(lostContactsSpec(), catalog), []);
  });

  check("relatedFilters con un cf inexistente → issue", () => {
    const spec = lostContactsSpec();
    const bad = { ...spec, query: { ...spec.query!, relatedFilters: [{ entity: "opportunity" as const, quantifier: "any" as const, conditions: [{ anyOf: [{ field: "cf:No Existe", op: "in" as const, values: ["x"] }] }] }] } };
    assert.equal(validateWidget(bad, catalog).length, 1);
  });

  check("relatedFilters sobre el mismo objeto de la fuente → issue (usa filters)", () => {
    const spec = lostContactsSpec();
    const bad = { ...spec, query: { ...spec.query!, relatedFilters: [{ entity: "contact" as const, quantifier: "any" as const, conditions: [] }] } };
    assert.ok(validateWidget(bad, catalog).some((i) => i.message.includes("filters")));
  });
}

function describeSection(): void {
  section("describe");
  const { ctx } = makeFixture();

  check("el ejemplo del dueño en palabras", () => {
    assert.equal(describeWidget(apptsByStageSpec()), "Citas · conteo · por etapa de la oportunidad más reciente · hereda fechas");
  });

  check("join each lo dice", () => {
    const s = apptsByStageSpec();
    const each = { ...s, query: { ...s.query!, groupBy: [dim("opportunity.stage", null, "each")] } };
    assert.ok(describeWidget(each).includes("cuenta una vez por cada oportunidad"));
  });

  check("cpl dice que ignora los filtros de CRM y qué es un lead", () => {
    const s = apptsByStageSpec();
    const cpl = { ...s, viz: "kpi" as const, query: { ...s.query!, source: "ads_daily" as const, metrics: [{ metric: "cpl" as const, label: null }], groupBy: [], time: { field: "date", range: "inherit" as const, from: null, to: null, compare: "none" as const } } };
    const text = describeWidget(cpl);
    assert.ok(text.includes("ignora los filtros de CRM"), text);
    assert.ok(text.includes("leads = oportunidades de pauta"), text);
  });

  check("filtros entre objetos en palabras (OR con «o»; none sin condiciones)", () => {
    const text = describeWidget(lostContactsSpec());
    assert.ok(text.includes("con alguna oportunidad con (estado = perdida o etapa = «Negocio Perdido»)"), text);
    const spec = lostContactsSpec();
    const none = { ...spec, query: { ...spec.query!, relatedFilters: [{ entity: "opportunity" as const, quantifier: "none" as const, conditions: [] }] } };
    assert.ok(describeWidget(none).includes("sin ninguna oportunidad"));
  });

  const widget = (id: string, spec: WidgetSpec) => ({ ...spec, id, createdAt: "2026-10-29T00:00:00Z", createdBy: "ai" as const, updatedAt: "2026-10-29T00:00:00Z" });
  const doc: DashboardDoc = {
    ...emptyDoc(),
    tabs: [
      { id: "t1", title: "Marketing", widgets: [] },
      { id: "t2", title: "Ventas", widgets: [widget("w8", apptsByStageSpec())] },
    ],
    glossary: [{ id: "g1", term: "perdido", aliases: ["perdidos"], entity: "opportunity", meaning: lostContactsSpec().query!.relatedFilters[0].conditions, note: "estado perdida o etapa «Negocio Perdido»", createdAt: "2026-10-29T00:00:00Z" }],
  };

  check("snapshot: marcador, seleccionado y glosario", () => {
    const snap = buildPanelSnapshot(doc, "t2", "w8", "Fecha = todo el historial · Pipeline = todos");
    assert.ok(snap.startsWith(PANEL_SNAPSHOT_MARKER));
    assert.ok(snap.includes("Seleccionado: [w8]"));
    assert.ok(/Glosario del cliente[^\n]*\n - «perdido»/.test(snap), snap);
    assert.ok(!buildPanelSnapshot({ ...doc, glossary: [] }, "t2", null, "x").includes("Glosario"));
  });

  check("snapshot: cada término del glosario lleva sus cláusulas exactas (valores crudos, no la nota en prosa)", () => {
    const snap = buildPanelSnapshot(doc, "t2", null, "x");
    const line = snap.split("\n").find((l) => l.includes("«perdido»")) ?? "";
    assert.ok(line.includes(JSON.stringify(doc.glossary[0].meaning)), line);
  });

  check("chips de filtros propios: periodo fijo y filtros entre objetos", () => {
    const spec = lostContactsSpec();
    assert.deepEqual(describeFilterChips(spec), ["Con alguna oportunidad con (estado = perdida o etapa = «Negocio Perdido»)"]);
    const fixed = { ...spec, query: { ...spec.query!, time: { ...spec.query!.time, range: "last_month" as const } } };
    assert.equal(describeFilterChips(fixed)[0], "Mes pasado · fijo");
    assert.deepEqual(describeFilterChips(apptsByStageSpec()), []);
  });

  check("catálogo estable entre llamadas", () => {
    assert.equal(buildPanelCatalogSummary(ctx), buildPanelCatalogSummary(ctx));
    assert.ok(buildPanelCatalogSummary(ctx).includes("Primera Cita"));
  });
}

function termsSection(): void {
  section("terms");
  const base = makeLostFixture();
  const contacts = base.dataset.contacts.map((c) => (c.id === "k4" ? { ...c, tags: ["perdido"] } : c));
  contacts.push(mkContact("k5", { customFieldsResolved: { Estatus: "Activo" } }));
  const ctx: EngineContext = {
    ...base,
    dataset: { ...base.dataset, contacts, appointments: [mkAppt("ap1", "k1", "2026-10-20T15:00:00Z", "showed")] },
  };
  const has = (res: ReturnType<typeof resolveTerm>, entity: string, field: string, values: string[]) =>
    res.candidates.some((c) => c.entity === entity && c.field === field && JSON.stringify(c.values) === JSON.stringify(values));

  check("termRoots quita sufijos y deja raíces de ≥4 letras", () => {
    assert.deepEqual(termRoots("perdidos"), ["perdid"]);
    assert.deepEqual(termRoots("clientes activos"), ["client", "activ"]);
  });

  check("«perdidos» aparece en estado (por su etiqueta), etapa y tag", () => {
    const res = resolveTerm("perdidos", null, ctx);
    assert.ok(has(res, "opportunity", "status", ["lost"]), JSON.stringify(res.candidates.map((c) => [c.entity, c.field, c.values])));
    assert.ok(has(res, "opportunity", "stage", ["Negocio Perdido"]));
    assert.ok(has(res, "contact", "tags", ["perdido"]));
    assert.equal(res.unionContacts, 3);
    assert.equal(res.materiallyDifferent, false);
  });

  check("con volumen y sin traslape → materiallyDifferent", () => {
    const extraContacts = [...ctx.dataset.contacts];
    const extraOpps = [...ctx.dataset.opportunities];
    for (let i = 0; i < 10; i++) {
      extraContacts.push(mkContact(`L${i}`), mkContact(`M${i}`));
      extraOpps.push(mkOpp(`ql${i}`, `L${i}`, "A", "Calificado", "2026-10-01T12:00:00Z", { status: "lost" }));
      extraOpps.push(mkOpp(`qm${i}`, `M${i}`, "A", "Negocio Perdido", "2026-10-01T12:00:00Z"));
    }
    const big = { ...ctx, dataset: { ...ctx.dataset, contacts: extraContacts, opportunities: extraOpps } };
    assert.equal(resolveTerm("perdidos", null, big).materiallyDifferent, true);
  });

  check("«asistió» con pista appointment → estado showed primero", () => {
    const res = resolveTerm("asistió", "appointment", ctx);
    assert.equal(res.candidates[0].entity, "appointment");
    assert.equal(res.candidates[0].field, "status");
    assert.deepEqual(res.candidates[0].values, ["showed"]);
  });

  check("«activo» encuentra el campo personalizado Estatus = Activo", () => {
    assert.ok(has(resolveTerm("activo", null, ctx), "contact", "cf:Estatus", ["Activo"]));
  });

  check("término inexistente o de menos de 4 letras → sin candidatos", () => {
    assert.deepEqual(resolveTerm("xyz123", null, ctx).candidates, []);
    assert.deepEqual(resolveTerm("pe", null, ctx).candidates, []);
  });

  // Shapes measured on lezgo-suite (2026-10-30): "perdido" lives in the status
  // (419 contacts), the stage "Prospecto Perdido" (398, all inside the first)
  // and in custom fields NAMED after it ("Motivo de Perdido", filled on 235);
  // the notes field matched words inside sentences; "desactivar bot" matched
  // "activo".
  const lezgoLike = (): EngineContext => {
    const cs: Contact[] = [];
    const os: Opportunity[] = [];
    for (let i = 0; i < 20; i++) {
      const motivo: Record<string, string> = i < 10 ? { "Motivo de Perdido": "Precio" } : {};
      cs.push(mkContact(`z${i}`, { tags: i < 6 ? ["desactivar bot"] : i < 9 ? ["pulso-activo"] : [] }));
      os.push(
        mkOpp(`zo${i}`, `z${i}`, "V", i < 19 ? "Prospecto Perdido" : "Primera Cita", "2026-10-01T12:00:00Z", {
          status: "lost",
          customFieldsResolved: { ...motivo, "Comentarios de Negociación": i < 4 ? "Se dio por perdido porque el cliente no respondió a la propuesta del 8 de octubre." : "" },
        })
      );
    }
    for (let i = 0; i < 6; i++) {
      cs.push(mkContact(`y${i}`));
      os.push(mkOpp(`yo${i}`, `y${i}`, "V", "Primera Cita", "2026-10-01T12:00:00Z"));
    }
    const b = makeLostFixture();
    return { ...b, dataset: { ...b.dataset, contacts: cs, opportunities: os }, pipelines: [{ id: "V", name: "Ventas", stages: ["Primera Cita", "Prospecto Perdido"] }] };
  };

  check("lecturas anidadas (etapa ⊂ estado) y campos que solo se LLAMAN como el concepto → no materiallyDifferent", () => {
    const res = resolveTerm("perdido", null, lezgoLike());
    assert.ok(has(res, "opportunity", "status", ["lost"]));
    assert.ok(has(res, "opportunity", "stage", ["Prospecto Perdido"]));
    assert.ok(res.candidates.some((c) => c.kind === "field_name" && c.field === "cf:Motivo de Perdido"), "el campo sigue como evidencia");
    assert.equal(res.materiallyDifferent, false);
  });

  check("el texto libre (notas largas) no es una lectura", () => {
    const res = resolveTerm("perdido", null, lezgoLike());
    assert.equal(res.candidates.some((c) => c.field === "cf:Comentarios de Negociación"), false, JSON.stringify(res.candidates.map((c) => c.field)));
  });

  check("«negocio perdido»: «negocio» nombra el objeto, no el concepto — también encuentra el estado perdida", () => {
    const res = resolveTerm("negocio perdido", null, ctx);
    assert.ok(has(res, "opportunity", "status", ["lost"]), JSON.stringify(res.candidates.map((c) => [c.field, c.values])));
    assert.ok(has(res, "opportunity", "stage", ["Negocio Perdido"]));
    assert.deepEqual(termRoots("clientes activos"), ["client", "activ"]);
    assert.deepEqual(termRoots("contactos activos"), ["activ"]);
    assert.deepEqual(termRoots("oportunidades"), ["oportunidad"]);
  });

  check("la raíz se busca al inicio de palabra: «desactivar bot» no es «activo», «pulso-activo» sí", () => {
    const res = resolveTerm("activo", null, lezgoLike());
    const tags = res.candidates.find((c) => c.field === "tags");
    assert.deepEqual(tags?.values, ["pulso-activo"]);
  });
}

function assistantSection(): void {
  section("assistant");
  const { ctx } = makeFixture();
  const ds = ctx.dataset;
  const lostDs = makeLostFixture().dataset;
  const groups = (res: unknown) =>
    Object.fromEntries(((res as { groups: { key: string; count: number }[] }).groups).map((g) => [g.key, g.count]));

  check("aggregate de citas por opportunity.stage cuenta CITAS", () => {
    assert.deepEqual(groups(executeTool("aggregate", { entity: "appointments", groupBy: "opportunity.stage", metric: "count" }, ds)), { Propuesta: 3, "Sin oportunidad": 1 });
  });

  check("status won usa isWonOpp (o3 ganada por etapa)", () => {
    assert.equal((executeTool("aggregate", { entity: "opportunities", groupBy: "none", metric: "count", filters: { status: "won" } }, ds) as { total: number }).total, 1);
  });

  check("no regresión: tags, relate y sum con contactIds idénticos a main", () => {
    assert.deepEqual(executeTool("aggregate", { entity: "contacts", groupBy: "tags", metric: "count" }, ds), {"groups":[{"key":"(sin tag)","count":3},{"key":"vip","count":1}],"total":4,"truncated":false});
    assert.deepEqual(executeTool("relate", { from: { entity: "appointments" }, to: { entity: "opportunities" }, groupBy: "stage", metric: "count" }, ds), {"groups":[{"key":"Primera Cita","count":1},{"key":"Propuesta","count":1}],"total":2,"truncated":false,"matchedContacts":1});
    assert.deepEqual(executeTool("aggregate", { entity: "opportunities", groupBy: "pipelineName", metric: "sum", includeContactIds: true }, ds), {"groups":[{"key":"p1","count":3,"sum":1000,"contactIds":["c1","c2","c3"]},{"key":"p2","count":1,"sum":0,"contactIds":["c1"]}],"total":4,"truncated":false});
  });

  const either = [{ anyOf: [{ field: "status", op: "eq", values: ["lost"] }, { field: "stage", op: "in", values: ["Negocio Perdido"] }] }];

  check("filtro clauses (OR entre campos) en aggregate y relate", () => {
    assert.equal((executeTool("aggregate", { entity: "opportunities", groupBy: "none", metric: "count", filters: { clauses: either } }, lostDs) as { total: number }).total, 2);
    assert.equal((executeTool("relate", { from: { entity: "opportunities", filters: { clauses: either } }, to: { entity: "contacts" }, metric: "count" }, lostDs) as { matchedContacts: number }).matchedContacts, 2);
  });

  check("resolve_term devuelve candidatos con su cláusula", () => {
    const res = executeTool("resolve_term", { term: "perdidos", entityHint: null }, lostDs) as { candidates: { clause: unknown }[] };
    assert.ok(res.candidates.length >= 2);
    assert.ok(res.candidates.every((c) => c.clause));
  });
}

function docOpsSection(): void {
  section("doc-ops");
  let n = 0;
  const meta: OpMeta = { now: "2026-10-30T00:00:00Z", by: "ai", id: () => `id${++n}` };
  const spec = apptsByStageSpec();
  const throwsDocOp = (fn: () => unknown, includes?: string) =>
    assert.throws(fn, (err: unknown) => err instanceof DocOpError && (!includes || err.message.includes(includes)));

  check("addWidgets en pestaña nueva crea la pestaña y devuelve 2 ids", () => {
    const start = emptyDoc();
    const before = structuredClone(start);
    const res = addWidgets(start, { tabId: null, newTabTitle: "Citas", widgets: [spec, spec], position: "end" }, meta);
    assert.equal(res.doc.tabs.length, 1);
    assert.equal(res.widgetIds.length, 2);
    assert.equal(res.doc.tabs[0].id, res.tabId);
    assert.deepEqual(start, before);
  });

  check("límites: widget 25 en una pestaña y pestaña 13 lanzan", () => {
    const full = addWidgets(emptyDoc(), { tabId: null, newTabTitle: "Llena", widgets: Array(DOC_LIMITS.maxWidgetsPerTab).fill(spec), position: "end" }, meta);
    throwsDocOp(() => addWidgets(full.doc, { tabId: full.tabId, newTabTitle: null, widgets: [spec], position: "end" }, meta));
    let doc = emptyDoc();
    for (let i = 0; i < DOC_LIMITS.maxTabs; i++) doc = upsertTab(doc, { tabId: null, title: `T${i}`, position: null }, meta.id).doc;
    throwsDocOp(() => upsertTab(doc, { tabId: null, title: "Una más", position: null }, meta.id));
  });

  check("arrangeTab exige una permutación exacta", () => {
    const res = addWidgets(emptyDoc(), { tabId: null, newTabTitle: "A", widgets: [spec, spec], position: "end" }, meta);
    const [w1, w2] = res.widgetIds;
    const arranged = arrangeTab(res.doc, res.tabId, [{ widgetId: w2, size: "s", height: "compact" }, { widgetId: w1, size: "xl", height: "tall" }]);
    assert.deepEqual(arranged.tabs[0].widgets.map((w) => [w.id, w.size]), [[w2, "s"], [w1, "xl"]]);
    throwsDocOp(() => arrangeTab(res.doc, res.tabId, [{ widgetId: w1, size: "s", height: "compact" }]));
  });

  check("ids que ya no existen → DocOpError «ya no existe»; el doc queda intacto", () => {
    const res = addWidgets(emptyDoc(), { tabId: null, newTabTitle: "A", widgets: [spec], position: "end" }, meta);
    const before = structuredClone(res.doc);
    throwsDocOp(() => updateWidget(res.doc, "no-existe", spec, meta), "ya no existe");
    throwsDocOp(() => deleteTab(res.doc, "no-existe"), "ya no existe");
    throwsDocOp(() => deleteWidgets(res.doc, ["no-existe"]), "ya no existe");
    throwsDocOp(() => moveWidgets(res.doc, res.widgetIds, "no-existe"), "ya no existe");
    assert.deepEqual(res.doc, before);
  });

  check("updateWidget conserva id y createdAt; moveWidgets mueve", () => {
    const res = addWidgets(emptyDoc(), { tabId: null, newTabTitle: "A", widgets: [spec], position: "end" }, meta);
    const b = upsertTab(res.doc, { tabId: null, title: "B", position: null }, meta.id);
    const updated = updateWidget(b.doc, res.widgetIds[0], { ...spec, title: "Otro" }, { ...meta, now: "2026-11-01T00:00:00Z" });
    const w = updated.tabs[0].widgets[0];
    assert.equal(w.id, res.widgetIds[0]);
    assert.equal(w.createdAt, "2026-10-30T00:00:00Z");
    assert.equal(w.updatedAt, "2026-11-01T00:00:00Z");
    assert.equal(w.title, "Otro");
    const moved = moveWidgets(updated, res.widgetIds, b.tabId);
    assert.equal(moved.tabs[0].widgets.length, 0);
    assert.equal(moved.tabs[1].widgets.length, 1);
  });

  check("setPanelFilters: 9 controles lanza; re-guardar conserva el id", () => {
    const control = { kind: "field" as const, entity: "opportunity" as const, label: "Asesor", field: "assignedTo", defaultValues: [], clause: null, defaultOn: false };
    const one = setPanelFilters(emptyDoc(), { defaultDate: null, defaultPipelines: [], controls: [control] }, meta.id);
    const id = one.filters.controls[0].id;
    const again = setPanelFilters(one, { defaultDate: "this_month", defaultPipelines: [], controls: [{ ...control, defaultValues: ["Ana"] }] }, meta.id);
    assert.equal(again.filters.controls[0].id, id);
    assert.deepEqual(again.filters.controls[0].defaultValues, ["Ana"]);
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...control, field: `cf:F${i}`, label: `F${i}` }));
    throwsDocOp(() => setPanelFilters(emptyDoc(), { defaultDate: null, defaultPipelines: [], controls: nine }, meta.id));
  });

  check("glosario: «perdido» y luego «Perdidos» (alias perdido) → una entrada; forgetTerm la borra", () => {
    const meaning = lostContactsSpec().query!.relatedFilters[0].conditions;
    const a = saveTerm(emptyDoc(), { term: "perdido", aliases: [], entity: "opportunity", meaning, note: "estado perdida" }, meta);
    const id = a.glossary[0].id;
    const b = saveTerm(a, { term: "Perdidos", aliases: ["perdido"], entity: "opportunity", meaning, note: "estado perdida o etapa «Negocio Perdido»" }, meta);
    assert.equal(b.glossary.length, 1);
    assert.equal(b.glossary[0].id, id);
    assert.equal(b.glossary[0].term, "Perdidos");
    assert.equal(forgetTerm(b, "PERDIDO").glossary.length, 0);
    throwsDocOp(() => forgetTerm(b, "inexistente"));
  });
}

function filterStateSection(): void {
  section("filter-state");
  const now = new Date(2026, 9, 29, 12, 0, 0);
  const asesor: FilterControl = { id: "c1", kind: "field", entity: "opportunity", label: "Asesor", field: "assignedTo", defaultValues: [], clause: null, defaultOn: false };
  const perdidos: FilterControl = {
    id: "c2", kind: "condition", entity: "opportunity", label: "Perdidos", field: null, defaultValues: [],
    clause: { anyOf: [{ field: "status", op: "eq", values: ["lost"] }, { field: "stage", op: "in", values: ["Negocio Perdido"] }] }, defaultOn: false,
  };
  const filters: PanelFilters = { defaultDate: "last_30d", defaultPipelines: [], controls: [asesor, perdidos] };

  check("initialFilterState: last_30d → preset month; last_month → custom desde el día 1 del mes anterior", () => {
    assert.equal(initialFilterState(filters, now).date.preset, "month");
    const lm = initialFilterState({ ...filters, defaultDate: "last_month" }, now).date;
    assert.equal(lm.preset, "custom");
    assert.equal(lm.from?.getDate(), 1);
    assert.equal(lm.from?.getMonth(), 8);
  });

  check("activeGlobalFilters: omite vacíos y apagados; incluye temporales; la condición aporta su cláusula intacta", () => {
    const base = initialFilterState(filters, now);
    assert.deepEqual(activeGlobalFilters(base, filters), []);
    const state = {
      ...base,
      values: { c1: ["Ana"] },
      on: { c2: true },
      temporary: [{ kind: "field" as const, entity: "contact" as const, label: "Fuente", field: "source", defaultValues: ["Meta"], clause: null, defaultOn: false }],
    };
    const active = activeGlobalFilters(state, filters);
    assert.equal(active.length, 3);
    assert.deepEqual(active[0].clause, { anyOf: [{ field: "assignedTo", op: "in", values: ["Ana"] }] });
    assert.deepEqual(active[1].clause, perdidos.clause);
    assert.equal(active[2].entity, "contact");
  });

  check("stateAsDefaults convierte un temporal en control con sus valores", () => {
    const state = { ...initialFilterState(filters, now), temporary: [{ kind: "field" as const, entity: "contact" as const, label: "Fuente", field: "source", defaultValues: ["Meta"], clause: null, defaultOn: false }] };
    const saved = stateAsDefaults(state, filters);
    const fuente = saved.controls.find((c) => c.label === "Fuente");
    assert.ok(fuente);
    assert.deepEqual(fuente!.defaultValues, ["Meta"]);
    assert.equal(saved.controls.length, 3);
  });

  check("describeFilterState marca los temporales", () => {
    const state = { ...initialFilterState(filters, now), temporary: [{ kind: "field" as const, entity: "opportunity" as const, label: "Asesor", field: "assignedTo", defaultValues: ["Ana"], clause: null, defaultOn: false }] };
    assert.ok(describeFilterState(state, { ...filters, controls: [] }, []).includes("Asesor = Ana (temporal)"));
  });

  check("staleValues: un predeterminado que ya no existe en los datos", () => {
    const { ctx } = makeFixture();
    const withAna = { ...filters, controls: [{ ...asesor, defaultValues: ["Ana"] }] };
    const state = initialFilterState(withAna, now);
    assert.deepEqual(staleValues(state, withAna, resolveCtx(ctx)), { c1: ["Ana"] });
  });
}

function suggestionsSection(): void {
  section("suggestions");
  const connected: AdsReport = { status: "connected", currency: "MXN", from: "2026-10-01", to: "2026-10-10", daily: [] };
  const hasCuesta = (ctx: EngineContext) => buildSuggestions(ctx).some((s) => /cuesta/i.test(s.label));

  check("sin Meta no se ofrece «cuánto me cuesta»; con Meta conectado sí", () => {
    assert.equal(hasCuesta(makeFixture().ctx), false);
    assert.equal(hasCuesta(makeFixture({ ads: { ...connected, status: "disconnected" } }).ctx), false);
    assert.equal(hasCuesta(makeFixture({ ads: connected }).ctx), true);
  });

  check("sin citas no se ofrece «Citas por etapa»", () => {
    const base = makeFixture().ctx;
    const noAppts: EngineContext = { ...base, dataset: { ...base.dataset, appointments: [] } };
    assert.ok(buildSuggestions(base).some((s) => /citas por etapa/i.test(s.label)));
    assert.equal(buildSuggestions(noAppts).some((s) => /citas/i.test(s.label)), false);
  });

  check("entre 4 y 6 sugerencias, cada una con su texto para la IA, deterministas", () => {
    const ctx = makeFixture().ctx;
    const out = buildSuggestions(ctx);
    assert.ok(out.length >= 4 && out.length <= 6, `${out.length}`);
    for (const s of out) assert.ok(s.label.length > 0 && s.prompt.length > s.label.length / 2, s.label);
    assert.deepEqual(buildSuggestions(ctx), out);
    assert.ok(buildSuggestions(makeFixture({ ads: connected }).ctx).length <= 6);
  });

  check("una cuenta vacía no recibe sugerencias que no puede responder", () => {
    const base = makeFixture().ctx;
    const empty: EngineContext = { ...base, dataset: { ...base.dataset, contacts: [], opportunities: [], appointments: [], pautas: [] } };
    assert.deepEqual(buildSuggestions(empty).filter((s) => /cita|venta|embudo|pauta/i.test(s.label)), []);
  });
}

// In-memory deps: commit applies the mutation and versions, like useDashboardDoc.
function makePanelHarness(ctx: EngineContext, opts: { conflict?: boolean } = {}) {
  let doc = emptyDoc();
  let version = 0;
  let n = 0;
  let filterState: PanelFilterState = initialFilterState(doc.filters, ctx.now);
  const seen = { activeTabs: [] as string[], applied: [] as PanelFilterState[] };
  const deps: PanelToolDeps = {
    getDoc: () => doc,
    commit: async (mutate) => {
      if (opts.conflict) return { ok: false, reason: "conflict", message: "El panel cambió en otra sesión; ya se recargó." };
      try {
        doc = mutate(doc);
      } catch (err) {
        if (err instanceof DocOpError) return { ok: false, reason: "invalid", message: err.message };
        throw err;
      }
      version++;
      return { ok: true, version };
    },
    engineCtx: () => ctx,
    activeTabId: () => doc.tabs[0]?.id ?? null,
    selectedWidgetId: () => null,
    setActiveTab: (id) => seen.activeTabs.push(id),
    getFilterState: () => filterState,
    applyFilterState: (next) => {
      filterState = next;
      seen.applied.push(next);
    },
    now: () => "2026-10-29T12:00:00.000Z",
    newId: () => `id${++n}`,
  };
  return {
    deps,
    seen,
    get doc() {
      return doc;
    },
    get version() {
      return version;
    },
    run: (name: string, input: Record<string, unknown>) => executePanelTool(name, input, deps) as Promise<Record<string, unknown>>,
  };
}

const LOST_CLAUSE = {
  anyOf: [
    { field: "status", op: "eq", values: ["lost"] },
    { field: "stage", op: "in", values: ["Negocio Perdido"] },
  ],
};

async function panelToolsSection(): Promise<void> {
  section("panel-tools");
  const ctx = makeFixture().ctx;

  await checkAsync("create_widgets con el ejemplo del dueño → pestaña nueva «Citas», 1 widget, y se activa", async () => {
    const h = makePanelHarness(ctx);
    const res = await h.run("create_widgets", { tabId: null, newTabTitle: "Citas", widgets: [apptsByStageSpec()], position: "end" });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(h.doc.tabs.length, 1);
    assert.equal(h.doc.tabs[0].title, "Citas");
    assert.equal(h.doc.tabs[0].widgets.length, 1);
    assert.deepEqual(res.widgetIds, [h.doc.tabs[0].widgets[0].id]);
    assert.deepEqual(h.seen.activeTabs, [h.doc.tabs[0].id]);
  });

  await checkAsync("create_widgets con «cf:Origen» → error con sugerencia y el panel sin cambios", async () => {
    const h = makePanelHarness(ctx);
    const base = apptsByStageSpec();
    const spec: WidgetSpec = {
      ...base,
      query: { ...base.query!, source: "contacts", groupBy: [{ dimension: "cf:Origen", bucket: null, join: null }], time: { ...base.query!.time, field: "createdAt" } },
    };
    const res = (await h.run("create_widgets", { tabId: null, newTabTitle: "X", widgets: [spec], position: "end" })) as { error?: string; issues?: { suggestion: string | null }[] };
    assert.ok(res.error);
    assert.equal(res.issues?.[0].suggestion, "cf:Origen de Lead");
    assert.equal(h.doc.tabs.length, 0);
    assert.equal(h.version, 0);
  });

  await checkAsync("create_widgets con forma inválida (zod) → error con issues, sin lanzar", async () => {
    const h = makePanelHarness(ctx);
    const res = (await h.run("create_widgets", { tabId: null, newTabTitle: "X", widgets: [{ title: "x" }], position: "end" })) as { error?: string; issues?: unknown[] };
    assert.ok(res.error && res.issues && res.issues.length > 0);
  });

  await checkAsync("update_widget sobre un widget borrado → { error } «ya no existe», sin lanzar", async () => {
    const h = makePanelHarness(ctx);
    const res = await h.run("update_widget", { widgetId: "borrado", widget: apptsByStageSpec() });
    assert.match(String(res.error), /ya no existe/);
  });

  await checkAsync("commit en conflicto → { error } que pide get_dashboard", async () => {
    const h = makePanelHarness(ctx, { conflict: true });
    const res = await h.run("create_widgets", { tabId: null, newTabTitle: "Citas", widgets: [apptsByStageSpec()], position: "end" });
    assert.match(String(res.error), /get_dashboard/);
  });

  await checkAsync("preview_widget: scope = describeWidget, ≤15 filas, no guarda nada", async () => {
    const h = makePanelHarness(ctx);
    const spec = apptsByStageSpec();
    const res = (await h.run("preview_widget", { widget: spec })) as { scope: string; rows: { label: string; values: unknown[] }[]; recordCount: number };
    assert.equal(res.scope, describeWidget(spec));
    assert.ok(res.rows.length > 0 && res.rows.length <= 15);
    assert.equal(typeof res.rows[0].label, "string");
    assert.equal(res.recordCount, 4);
    assert.equal(h.version, 0);
  });

  await checkAsync("set_panel_filters: control de asesor sin etiqueta → «Asesor»; pipeline desconocido → error con los nombres válidos", async () => {
    const h = makePanelHarness(ctx);
    const control = { kind: "field", entity: "opportunity", label: null, field: "assignedTo", defaultValues: [], clause: null, defaultOn: false };
    const ok = await h.run("set_panel_filters", { defaultDate: null, defaultPipelines: [], controls: [control] });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(h.doc.filters.controls.length, 1);
    assert.equal(h.doc.filters.controls[0].label, "Asesor");
    const bad = await h.run("set_panel_filters", { defaultDate: null, defaultPipelines: ["No Existe"], controls: [] });
    assert.match(String(bad.error), /No Existe/);
    assert.match(String(bad.error), /p1/);
    const named = await h.run("set_panel_filters", { defaultDate: "last_30d", defaultPipelines: ["p2"], controls: [control] });
    assert.equal(named.ok, true);
    assert.deepEqual(h.doc.filters.defaultPipelines, ["p2"]);
  });

  await checkAsync("set_panel_filters con defaultDate/defaultPipelines null conserva los predeterminados guardados", async () => {
    const h = makePanelHarness(ctx);
    const control = { kind: "field", entity: "opportunity", label: null, field: "assignedTo", defaultValues: [], clause: null, defaultOn: false };
    await h.run("set_panel_filters", { defaultDate: "last_30d", defaultPipelines: ["p1"], controls: [] });
    const res = await h.run("set_panel_filters", { defaultDate: null, defaultPipelines: null, controls: [control] });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(h.doc.filters.defaultDate, "last_30d");
    assert.deepEqual(h.doc.filters.defaultPipelines, ["p1"]);
    assert.equal(h.doc.filters.controls.length, 1);
    const cleared = await h.run("set_panel_filters", { defaultDate: "all", defaultPipelines: [], controls: [control] });
    assert.equal(cleared.ok, true);
    assert.equal(h.doc.filters.defaultDate, "all");
    assert.deepEqual(h.doc.filters.defaultPipelines, []);
  });

  await checkAsync("set_panel_filters: un campo inexistente en un control → error con sugerencia", async () => {
    const h = makePanelHarness(ctx);
    const control = { kind: "field", entity: "contact", label: null, field: "cf:Origen", defaultValues: [], clause: null, defaultOn: false };
    const res = (await h.run("set_panel_filters", { defaultDate: null, defaultPipelines: [], controls: [control] })) as { error?: string; issues?: { suggestion: string | null }[] };
    assert.ok(res.error);
    assert.equal(res.issues?.[0].suggestion, "cf:Origen de Lead");
  });

  await checkAsync("set_panel_filters con condición «Perdidos» encendida → activeGlobalFilters la incluye", async () => {
    const h = makePanelHarness(ctx);
    const cond = { kind: "condition", entity: "opportunity", label: "Perdidos", field: null, defaultValues: [], clause: LOST_CLAUSE, defaultOn: true };
    const res = await h.run("set_panel_filters", { defaultDate: null, defaultPipelines: [], controls: [cond] });
    assert.equal(res.ok, true, JSON.stringify(res));
    const active = activeGlobalFilters(initialFilterState(h.doc.filters, ctx.now), h.doc.filters);
    assert.deepEqual(active.map((a) => a.label), ["Perdidos"]);
  });

  await checkAsync("apply_filters: un valor sin control → chip temporal contact.source; el doc no cambia de versión", async () => {
    const h = makePanelHarness(ctx);
    const res = (await h.run("apply_filters", { date: null, pipelines: null, values: [{ entity: "contact", field: "source", values: ["Meta"] }], conditions: [] })) as { ok?: boolean; filters?: string };
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(h.version, 0);
    const last = h.seen.applied.at(-1)!;
    assert.equal(last.temporary.length, 1);
    assert.equal(last.temporary[0].entity, "contact");
    assert.equal(last.temporary[0].field, "source");
    assert.deepEqual(last.temporary[0].defaultValues, ["Meta"]);
    assert.match(String(res.filters), /temporal/);
  });

  await checkAsync("apply_filters: valor sobre un control existente lo usa; fecha y pipeline por nombre", async () => {
    const h = makePanelHarness(ctx);
    const control = { kind: "field", entity: "opportunity", label: null, field: "assignedTo", defaultValues: [], clause: null, defaultOn: false };
    await h.run("set_panel_filters", { defaultDate: null, defaultPipelines: [], controls: [control] });
    const id = h.doc.filters.controls[0].id;
    const res = await h.run("apply_filters", {
      date: { range: "last_30d", from: null, to: null },
      pipelines: ["p1"],
      values: [{ entity: "opportunity", field: "assignedTo", values: ["Ana"] }],
      conditions: [],
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    const last = h.seen.applied.at(-1)!;
    assert.deepEqual(last.values[id], ["Ana"]);
    assert.equal(last.temporary.length, 0);
    assert.deepEqual(last.pipelines, ["p1"]);
    assert.equal(last.date.preset, "month");
    const bad = await h.run("apply_filters", { date: null, pipelines: ["Nada"], values: [], conditions: [] });
    assert.ok(bad.error);
  });

  await checkAsync("save_term guarda en el glosario y el snapshot lo muestra; un campo inexistente → error con issues", async () => {
    const h = makePanelHarness(ctx);
    const res = await h.run("save_term", { term: "perdido", aliases: ["perdidos"], entity: "opportunity", meaning: [LOST_CLAUSE], note: "estado perdida o etapa «Negocio Perdido»" });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(h.doc.glossary.length, 1);
    assert.match(buildPanelSnapshot(h.doc, null, null, "Fecha = todo"), /«perdido».*Negocio Perdido/);
    const bad = (await h.run("save_term", {
      term: "frío",
      aliases: [],
      entity: "opportunity",
      meaning: [{ anyOf: [{ field: "temperatura", op: "eq", values: ["fría"] }] }],
      note: "x",
    })) as { error?: string; issues?: unknown[] };
    assert.ok(bad.error && bad.issues?.length);
    assert.equal(h.doc.glossary.length, 1);
    const gone = await h.run("forget_term", { term: "Perdidos" });
    assert.equal(gone.ok, true);
    assert.equal(h.doc.glossary.length, 0);
  });

  await checkAsync("get_dashboard: pestañas, widgets con su regla, filtros y controles con valores", async () => {
    const h = makePanelHarness(ctx);
    await h.run("create_widgets", { tabId: null, newTabTitle: "Citas", widgets: [apptsByStageSpec()], position: "end" });
    await h.run("set_panel_filters", {
      defaultDate: null,
      defaultPipelines: [],
      controls: [{ kind: "field", entity: "opportunity", label: null, field: "stage", defaultValues: [], clause: null, defaultOn: false }],
    });
    const res = (await h.run("get_dashboard", { tabId: null })) as {
      tabs: { title: string }[];
      tab: { widgets: { scope: string }[] } | null;
      filters: string;
      controls: { available: { value: string }[] }[];
    };
    assert.deepEqual(res.tabs.map((t) => t.title), ["Citas"]);
    assert.equal(res.tab?.widgets[0].scope, describeWidget(apptsByStageSpec()));
    assert.match(res.filters, /Etapa = todos/);
    assert.ok(res.controls[0].available.some((v) => v.value === "Propuesta"));
  });

  await checkAsync("delete_widgets / upsert_tab / arrange_tab / move_widgets / delete_tab devuelven versión; ids desconocidos → error", async () => {
    const h = makePanelHarness(ctx);
    const created = await h.run("create_widgets", { tabId: null, newTabTitle: "A", widgets: [apptsByStageSpec(), apptsByStageSpec()], position: "end" });
    const [w1, w2] = created.widgetIds as string[];
    const tabA = h.doc.tabs[0].id;
    const tabB = await h.run("upsert_tab", { tabId: null, title: "B", position: null });
    assert.equal(tabB.ok, true);
    const arranged = await h.run("arrange_tab", { tabId: tabA, items: [{ widgetId: w2, size: "s", height: "compact" }, { widgetId: w1, size: "l", height: "tall" }] });
    assert.equal(arranged.ok, true, JSON.stringify(arranged));
    assert.deepEqual(h.doc.tabs[0].widgets.map((w) => w.id), [w2, w1]);
    const moved = await h.run("move_widgets", { widgetIds: [w1], toTabId: tabB.tabId as string });
    assert.equal(moved.ok, true);
    assert.equal(h.doc.tabs[1].widgets.length, 1);
    assert.equal((await h.run("delete_widgets", { widgetIds: [w2] })).ok, true);
    assert.match(String((await h.run("delete_widgets", { widgetIds: [w2] })).error), /ya no existe/);
    assert.equal((await h.run("delete_tab", { tabId: tabA })).ok, true);
    assert.equal(h.doc.tabs.length, 1);
  });

  await checkAsync("get_widget_data: filas del widget guardado; id desconocido → error", async () => {
    const h = makePanelHarness(ctx);
    const created = await h.run("create_widgets", { tabId: null, newTabTitle: "A", widgets: [apptsByStageSpec()], position: "end" });
    const res = (await h.run("get_widget_data", { widgetId: (created.widgetIds as string[])[0], limit: 1 })) as { rows: unknown[] };
    assert.equal(res.rows.length, 1);
    assert.match(String((await h.run("get_widget_data", { widgetId: "x", limit: null })).error), /ya no existe/);
  });

  check("esquemas: cada objeto con additionalProperties false y required completo", () => {
    const visit = (node: unknown, path: string): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach((x, i) => visit(x, `${path}[${i}]`));
      const o = node as Record<string, unknown>;
      if (o.type === "object") {
        assert.equal(o.additionalProperties, false, `${path}: additionalProperties`);
        assert.deepEqual([...((o.required as string[]) ?? [])].sort(), Object.keys((o.properties as object) ?? {}).sort(), `${path}: required`);
      }
      for (const [k, v] of Object.entries(o)) visit(v, `${path}.${k}`);
    };
    for (const t of PANEL_TOOL_DEFINITIONS) visit(t.input_schema, t.name);
  });

  check("strict solo en el conjunto que la API compiló (2026-10-30: 10 strict → «compiled grammar is too large»)", () => {
    const strict = PANEL_MODE_TOOLS.filter((t) => (t as { strict?: boolean }).strict === true).map((t) => t.name).sort();
    // save_term left the set on 2026-11-02 (kind "field" grew its schema): 8 strict, validated in the executor.
    assert.deepEqual(strict, ["arrange_tab", "delete_tab", "delete_widgets", "forget_term", "get_dashboard", "get_widget_data", "move_widgets", "upsert_tab"]);
  });

  await checkAsync("set_panel_filters / apply_filters (sin strict) rechazan una forma inválida con issues, sin lanzar", async () => {
    const h = makePanelHarness(ctx);
    const bad = (await h.run("set_panel_filters", { defaultDate: null, defaultPipelines: null, controls: [{ kind: "campo", entity: "persona" }] })) as { error?: string; issues?: unknown[] };
    assert.ok(bad.error && bad.issues?.length, JSON.stringify(bad));
    const bad2 = (await h.run("apply_filters", { date: null, pipelines: null, values: [{ entity: "persona", field: "x", values: "Meta" }], conditions: [{ entity: "opportunity", label: "X" }] })) as { error?: string; issues?: unknown[] };
    assert.ok(bad2.error && bad2.issues?.length, JSON.stringify(bad2));
    assert.equal(h.version, 0);
  });

  check("las herramientas strict caben en los límites de la API (≤20 strict, ≤16 uniones, 0 opcionales)", () => {
    // platform.claude.com/docs/en/build-with-claude/structured-outputs: limits are
    // per REQUEST, across every strict schema; past them the request is a 400.
    const strict = PANEL_MODE_TOOLS.filter((t) => (t as { strict?: boolean }).strict === true);
    let unions = 0;
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      const o = node as Record<string, unknown>;
      if (Array.isArray(o.anyOf) || Array.isArray(o.type)) unions++;
      for (const v of Object.values(o)) visit(v);
    };
    for (const t of strict) visit(t.input_schema);
    assert.ok(strict.length > 0 && strict.length <= 20, `strict: ${strict.length}`);
    assert.ok(unions <= 16, `uniones: ${unions}`);
  });

  check("PANEL_MODE_TOOLS: el asistente sin gráficas de chat/PDF/adjuntos, resolve_term incluido, luego las del panel", () => {
    const names = PANEL_MODE_TOOLS.map((t) => t.name);
    for (const gone of ["render_chart", "show_in_panel", "create_pdf", "list_uploaded_files", "query_uploaded_table", "join_uploaded_table"]) {
      assert.equal(names.includes(gone), false, gone);
    }
    assert.ok(names.includes("resolve_term") && names.includes("ask_user"));
    assert.deepEqual(names.slice(-PANEL_TOOL_DEFINITIONS.length), PANEL_TOOL_DEFINITIONS.map((t) => t.name));
    assert.equal(new Set(names).size, names.length);
  });

  check("buildChatRequest(assistant) = el cuerpo que armaba la ruta; panel agrega su sección y sus herramientas", () => {
    const now = new Date("2026-10-29T18:30:00Z");
    const tz = "America/Mexico_City";
    const messages = [{ role: "user" as const, content: "hola" }];
    const today = now.toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: tz });
    const time = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: tz });
    // Literal of app/api/chat/route.ts before the change.
    const expected = {
      model: "claude-sonnet-5",
      thinking: { type: "adaptive" },
      max_tokens: 16000,
      system: [
        { type: "text", text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: "DS", cache_control: { type: "ephemeral" } },
        {
          type: "text",
          text: `Fecha y hora actuales: ${today}, ${time} (zona horaria ${tz}). Usa esto para resolver referencias relativas como "hoy", "ayer", "esta semana", "esta mañana" o "ahora".`,
        },
      ],
      tools: TOOL_DEFINITIONS,
      messages: [{ role: "user", content: [{ type: "text", text: "hola", cache_control: { type: "ephemeral" } }] }],
    };
    const got = buildChatRequest({ mode: "assistant", datasetSummary: "DS", messages, userTimezone: tz, now });
    assert.deepEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(expected)));
    const panel = buildChatRequest({ mode: "panel", datasetSummary: "DS", messages, userTimezone: tz, now });
    assert.equal((panel.system as { text: string }[])[0].text, `${ASSISTANT_SYSTEM_PROMPT}\n\n${PANEL_PROMPT_SECTION}`);
    assert.deepEqual(panel.tools, PANEL_MODE_TOOLS);
    assert.equal(buildChatRequest({ mode: "assistant", datasetSummary: "DS", messages, userTimezone: tz, now, maxTokens: 900 }).max_tokens, 900);
  });
}

async function docLoadSection(): Promise<void> {
  section("doc-load");

  check("docProblem: dice QUÉ campo del doc rompe un límite, antes de mandarlo al servidor", () => {
    assert.equal(docProblem(emptyDoc()), null);
    const longNote: DashboardDoc = {
      ...emptyDoc(),
      glossary: [{ id: "g1", term: "activo", aliases: [], entity: "contact", meaning: [{ anyOf: [{ field: "tags", op: "in", values: ["x"] }] }], note: "n".repeat(301), createdAt: "2026-10-30T00:00:00Z" }],
    };
    assert.match(String(docProblem(longNote)), /glossary\.0\.note/);
  });

  check("panelSettled: el autoajuste de fecha espera la respuesta del panel, pero no para siempre si falla", () => {
    assert.equal(panelSettled({ enabled: null, error: null }), false);
    assert.equal(panelSettled({ enabled: false, error: null }), true);
    assert.equal(panelSettled({ enabled: true, error: null }), true);
    assert.equal(panelSettled({ enabled: null, error: "HTTP 500" }), true);
  });

  await checkAsync("withRetry: reintenta una falla pasajera y se rinde después de los intentos", async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls < 2) throw new Error("red");
      return "ok";
    };
    assert.equal(await withRetry(flaky, 2, 0), "ok");
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw new Error("caído"); }, 2, 0), /caído/);
    assert.equal(calls, 2);
  });
}

async function main(): Promise<void> {
  specSection();
  domainSection();
  semanticSection();
  metricsSection();
  engineSection();
  joinSection();
  adsSection();
  compareSection();
  validateSection();
  describeSection();
  termsSection();
  assistantSection();
  docOpsSection();
  filterStateSection();
  suggestionsSection();
  await panelToolsSection();
  await docLoadSection();
  console.log("\n✅ lib/widgets — all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
