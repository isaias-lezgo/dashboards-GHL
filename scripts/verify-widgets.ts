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
import type { Appointment, Contact, Opportunity, Pauta, Pipeline } from "../lib/types";
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
    o4: mkOpp("o4", "c3", "p1", "Primera Cita", "2026-10-10T12:00:00Z", { status: "lost", lostReason: "Precio" }),
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

function main(): void {
  specSection();
  domainSection();
  semanticSection();
  metricsSection();
  console.log("\n✅ lib/widgets — all assertions passed");
}

main();
