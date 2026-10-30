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
import type { ChatDataset } from "../lib/ai-tools";
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
import { PANEL_SNAPSHOT_MARKER, buildPanelCatalogSummary, buildPanelSnapshot, describeWidget } from "../lib/widgets/describe";
import { resolveTerm, termRoots } from "../lib/widgets/terms";
import { QueryError, type ActiveGlobalFilter } from "../lib/widgets/semantic";
import type { QuerySpec } from "../lib/widgets/spec";

let currentSection = "";
function section(name: string): void {
  currentSection = name;
  console.log(`\n— ${name}`);
}
function check(name: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`  ✗ [${currentSection}] ${name}`);
    throw err;
  }
  console.log(`  ✓ ${name}`);
}

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

function mkContact(id: string, extra: Partial<Contact> = {}): Contact {
  return { id, name: id, email: "", phone: "", tags: [], dateAdded: "2026-08-01T12:00:00Z", createdAt: "2026-08-01T12:00:00Z", ...extra };
}
function mkOpp(id: string, contactId: string, pipelineId: string, stage: string, createdAt: string, extra: Partial<Opportunity> = {}): Opportunity {
  return {
    id, name: id, pipelineId, pipelineStageId: stage, status: "open", createdAt, contactId,
    value: 0, stage, pipelineName: pipelineId, ...extra,
  };
}
function mkAppt(id: string, contactId: string, startTime: string, status: string): Appointment {
  return { id, contactId, startTime, endTime: startTime, status };
}

interface Fixture {
  ctx: EngineContext;
  c: Record<string, Contact>;
  o: Record<string, Opportunity>;
}

function makeFixture(overrides: Partial<EngineContext> = {}): Fixture {
  const c = {
    c1: mkContact("c1", { tags: ["vip"], customFieldsResolved: { "Origen de Lead": ["Facebook", "Instagram"] } }),
    c2: mkContact("c2"),
    c3: mkContact("c3"),
    c4: mkContact("c4"),
  };
  const o = {
    o1: mkOpp("o1", "c1", "p1", "Primera Cita", "2026-09-01T12:00:00Z"),
    o2: mkOpp("o2", "c1", "p2", "Propuesta", "2026-10-01T12:00:00Z"),
    o3: mkOpp("o3", "c2", "p1", "Negocio Ganado", "2026-10-05T12:00:00Z", { value: 1000, closedAt: "2026-10-06T12:00:00Z" }),
    o4: mkOpp("o4", "c3", "p1", "Seguimiento", "2026-10-10T12:00:00Z", { status: "lost", lostReason: "Precio" }),
  };
  const pautas: Pauta[] = [
    { id: "p-a", tipo: "", nombrePauta: "", createdAt: "2026-09-01T12:00:00Z", contactId: "c1" },
    { id: "p-b", tipo: "", nombrePauta: "", createdAt: "2026-10-02T12:00:00Z", contactId: "c1" },
    { id: "p-c", tipo: "", nombrePauta: "", createdAt: "2026-10-03T12:00:00Z" },
  ];
  const dataset: ChatDataset = {
    contacts: Object.values(c),
    opportunities: Object.values(o),
    pautas,
    appointments: [
      mkAppt("a1", "c1", "2026-10-20T15:00:00Z", "showed"),
      mkAppt("a2", "c1", "2026-10-21T15:00:00Z", "noshow"),
      mkAppt("a3", "c1", "2026-10-22T15:00:00Z", "showed"),
      mkAppt("a4", "c4", "2026-10-23T15:00:00Z", "confirmed"),
    ],
    messages: [],
    tasks: [],
    calls: [],
  };
  const pipelines: Pipeline[] = [
    { id: "p1", name: "p1", stages: ["Primera Cita", "Negocio Ganado"] },
    { id: "p2", name: "p2", stages: ["Propuesta"] },
  ];
  const ctx: EngineContext = {
    dataset,
    pipelines,
    ads: undefined,
    dateRange: null,
    pipelineFilter: [],
    globalFilters: [],
    now: new Date(2026, 9, 29, 12, 0, 0),
    ...overrides,
  };
  return { ctx, c, o };
}

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

// A query with sensible defaults; tests override only what they exercise.
function q(over: Partial<QuerySpec>): QuerySpec {
  return {
    source: "opportunities",
    metrics: [{ metric: "count", label: null }],
    groupBy: [],
    filters: [],
    relatedFilters: [],
    time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" },
    globalFilters: "inherit",
    sort: { by: "value", dir: "desc" },
    limit: null,
    ...over,
  };
}
const dim = (dimension: string, bucket: QuerySpec["groupBy"][number]["bucket"] = null, join: QuerySpec["groupBy"][number]["join"] = null) => ({ dimension, bucket, join });
const byLabel = (res: QueryResult, metric = 0): Record<string, number | null> =>
  Object.fromEntries(res.rows.map((r) => [r.label.join(" · "), r.values[metric]]));
const ids = (res: QueryResult): string[] => res.rows.flatMap((r) => r.records.map((x) => String(x.id))).sort();

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
    assert.ok(snap.includes("Glosario del cliente: «perdido»"));
    assert.ok(!buildPanelSnapshot({ ...doc, glossary: [] }, "t2", null, "x").includes("Glosario"));
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
}

function main(): void {
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
  console.log("\n✅ lib/widgets — all assertions passed");
}

main();
