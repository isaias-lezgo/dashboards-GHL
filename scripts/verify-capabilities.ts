// Verification for the copilot's second round of capabilities. Run: pnpm verify:capabilities
//
// Plan: docs/superpowers/plans/2026-11-02-copiloto-robusto.md — several sources
// in one chart, proportions, custom DATE fields, combined fields, outcome,
// matrix, "días desde" and conversations. Same discipline as verify-widgets:
// a silent bug here is a plausible chart counting the wrong population.
//
// Wrapped in main() rather than using top-level await: this package is CJS.
import assert from "node:assert/strict";
import {
  BUCKETS,
  FILTER_OPS,
  SOURCES,
  VIZ_TYPES,
  conversationDaysOf,
  dashboardDocSchema,
  edgesOf,
  fallbacksOf,
  glossaryKind,
  parseDoc,
  seriesOf,
  WIDGET_SPEC_JSON_SCHEMA,
  FILTER_SPEC_JSON_SCHEMA,
  widgetSpecSchema,
  type DashboardDoc,
  type GlossaryEntry,
  type WidgetSpec,
} from "../lib/widgets/spec";
import { section, check, q, makeFixture, mkContact, mkOpp } from "./lib/widget-test-kit";
import {
  EMPTY_VALUE,
  dateValue,
  fieldValuesWithFallbacks,
  isDateField,
  matchesFilter,
  outcomeOf,
  resolveCtx,
  type EngineContext,
} from "../lib/widgets/semantic";
import type { Opportunity } from "../lib/types";
import { QueryError } from "../lib/widgets/semantic";
import { ageBucketKey, runQuery } from "../lib/widgets/engine";
import { byLabel, dim } from "./lib/widget-test-kit";
import { buildCatalog, validateWidget } from "../lib/widgets/validate";
import { channelLabel, contactMessageDates, lastOutboundFrom, needsThread, toIso, type ConversationRow } from "../lib/conversation-index";
import type { QuerySpec, VizType } from "../lib/widgets/spec";
import type { FilterClause, MetricId, RelatedFilterSpec, SeriesSpec, SourceId, TimeSpec } from "../lib/widgets/spec";
import { customFieldTypeMap } from "../lib/sync";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW_ISO = "2026-10-29T12:00:00.000Z";

// A KPI exactly as the first phase saved it — no key added after 2026-10-30.
const LEGACY_KPI = {
  title: "Leads del mes",
  subtitle: null,
  viz: "kpi",
  size: "s",
  height: "compact",
  query: {
    source: "contacts",
    metrics: [{ metric: "count", label: null }],
    groupBy: [],
    filters: [],
    relatedFilters: [],
    time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" },
    globalFilters: "inherit",
    sort: { by: "value", dir: "desc" },
    limit: null,
  },
  text: null,
  target: null,
  nativeId: null,
  prompt: "Leads del mes",
};

const LEGACY_DOC = {
  schemaVersion: 1,
  tabs: [
    {
      id: "t1",
      title: "Ventas",
      widgets: [
        { ...LEGACY_KPI, id: "w1", createdAt: NOW_ISO, createdBy: "ai", updatedAt: NOW_ISO },
        {
          ...LEGACY_KPI,
          id: "w2",
          title: "Citas por etapa",
          viz: "stacked_bar",
          size: "l",
          height: "normal",
          query: {
            ...LEGACY_KPI.query,
            source: "appointments",
            groupBy: [
              { dimension: "startTime", bucket: "month", join: null },
              { dimension: "opportunity.stage", bucket: null, join: "latest" },
            ],
            time: { field: "startTime", range: "inherit", from: null, to: null, compare: "none" },
          },
          createdAt: NOW_ISO,
          createdBy: "ai",
          updatedAt: NOW_ISO,
        },
      ],
    },
  ],
  filters: {
    defaultDate: "last_month",
    defaultPipelines: [],
    controls: [
      { id: "k1", kind: "field", entity: "opportunity", label: "Asesor", field: "assignedTo", defaultValues: [], clause: null, defaultOn: false },
    ],
  },
  glossary: [
    {
      id: "g1",
      term: "clientes activos",
      aliases: [],
      entity: "contact",
      meaning: [{ anyOf: [{ field: "tags", op: "in", values: ["cliente activo"] }] }],
      note: "",
      createdAt: NOW_ISO,
    },
  ],
};

function docWithGlossary(entry: Partial<GlossaryEntry>): DashboardDoc {
  const doc = JSON.parse(JSON.stringify(LEGACY_DOC)) as DashboardDoc;
  doc.glossary = [{ ...doc.glossary[0], term: "sucursal", entity: "opportunity", ...entry }];
  return doc;
}

const withQuery = (over: Record<string, unknown>): unknown => ({ ...LEGACY_KPI, query: { ...LEGACY_KPI.query, ...over } });

const extraSeries = (label: string) => ({
  label,
  source: "contacts",
  metric: "count",
  filters: [],
  relatedFilters: [],
  dateField: "createdAt",
  dimension: null,
});

// ─── Task 1: vocabulary and optional properties ───────────────────────────────

function specSection(): void {
  section("spec: vocabulary and optional properties");

  check("a v1 doc saved before this change still parses", () => {
    const doc = parseDoc(JSON.parse(JSON.stringify(LEGACY_DOC)));
    assert.equal(doc.tabs[0].widgets.length, 2);
    assert.equal(seriesOf(doc.tabs[0].widgets[0].query!).length, 0);
    assert.equal(glossaryKind(doc.glossary[0]), "condition");
  });

  check("new vocabulary is accepted", () => {
    assert.ok((VIZ_TYPES as readonly string[]).includes("matrix"));
    assert.ok((SOURCES as readonly string[]).includes("conversations"));
    assert.ok((BUCKETS as readonly string[]).includes("age"));
    assert.ok((FILTER_OPS as readonly string[]).includes("days_ago_gte"));
    assert.ok((FILTER_OPS as readonly string[]).includes("days_ago_lte"));
  });

  check("a multi-series widget with a ratio parses", () => {
    const w = withQuery({
      series: [{ ...extraSeries("Con oportunidad"), relatedFilters: [{ entity: "opportunity", quantifier: "any", conditions: [] }] }],
      ratio: { label: "% con oportunidad", numerator: 1, denominator: 0 },
      conversationDays: null,
    });
    const parsed = widgetSpecSchema.safeParse(w);
    assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues[0]));
  });

  check("limits: 6 extra series, 4 fallbacks and 9 edges are refused", () => {
    const six = Array.from({ length: 6 }, (_, i) => extraSeries(`S${i}`));
    assert.equal(widgetSpecSchema.safeParse(withQuery({ series: six })).success, false);
    const fourFallbacks = withQuery({ groupBy: [{ dimension: "cf:A", bucket: null, join: null, fallbacks: ["cf:B", "cf:C", "cf:D", "cf:E"] }] });
    assert.equal(widgetSpecSchema.safeParse(fourFallbacks).success, false);
    const nineEdges = withQuery({ groupBy: [{ dimension: "createdAt", bucket: "age", join: null, edges: [1, 2, 3, 4, 5, 6, 7, 8, 9] }] });
    assert.equal(widgetSpecSchema.safeParse(nineEdges).success, false);
  });

  check("glossary field kind needs fields, condition kind needs meaning", () => {
    assert.equal(dashboardDocSchema.safeParse(docWithGlossary({ kind: "field", fields: [], meaning: [] })).success, false);
    assert.ok(dashboardDocSchema.safeParse(docWithGlossary({ kind: "field", fields: ["cf:Sucursal VAEO", "cf:Sucursal MESH"], meaning: [] })).success);
    assert.equal(dashboardDocSchema.safeParse(docWithGlossary({ kind: "condition", meaning: [] })).success, false);
  });

  check("normalizers give defaults", () => {
    assert.deepEqual(edgesOf({ dimension: "createdAt", bucket: "age", join: null }), [7, 15, 30, 60]);
    assert.deepEqual(edgesOf({ dimension: "createdAt", bucket: "age", join: null, edges: [10, 20] }), [10, 20]);
    assert.equal(conversationDaysOf(q({})), 60);
    assert.equal(conversationDaysOf(q({ conversationDays: 120 })), 120);
    assert.deepEqual(fallbacksOf({}), []);
    assert.deepEqual(fallbacksOf({ fallbacks: null }), []);
    assert.deepEqual(fallbacksOf({ fallbacks: ["cf:B"] }), ["cf:B"]);
  });

  check("the model-facing JSON schema carries the new properties", () => {
    type Props = { properties: Record<string, unknown> };
    const props = (o: unknown): Record<string, unknown> => (o as Props).properties;
    const query = (props(WIDGET_SPEC_JSON_SCHEMA).query as { anyOf: unknown[] }).anyOf[0];
    for (const k of ["series", "ratio", "conversationDays"]) assert.ok(k in props(query), k);
    const groupItem = (props(query).groupBy as { items: unknown }).items;
    for (const k of ["fallbacks", "edges"]) assert.ok(k in props(groupItem), k);
    assert.ok("fallbacks" in props(FILTER_SPEC_JSON_SCHEMA));
  });

  check("a legacy widget spec type-checks without the new keys", () => {
    const w: WidgetSpec = LEGACY_KPI as WidgetSpec;
    assert.ok(widgetSpecSchema.safeParse(w).success);
  });
}

// ─── Task 2: custom field types in the payload ────────────────────────────────

function syncSection(): void {
  section("sync: custom field types");

  check("customFieldTypeMap keys by model and name", () => {
    const m = customFieldTypeMap([
      { id: "1", name: "Fecha de Cierre", dataType: "DATE", model: "opportunity" },
      { id: "2", name: "Fecha de Cierre", dataType: "TEXT", model: "contact" },
      { id: "3", name: "Sin tipo" },
    ]);
    assert.deepEqual(m, { "opportunity:Fecha de Cierre": "DATE", "contact:Fecha de Cierre": "TEXT" });
  });

  check("a field without model is a contact field and dataType is upper-cased", () => {
    assert.deepEqual(customFieldTypeMap([{ id: "1", name: "Cumpleaños", dataType: "date" }]), { "contact:Cumpleaños": "DATE" });
  });
}

// ─── Task 3: semantic layer ───────────────────────────────────────────────────

type Row = Record<string, unknown>;

function fixtureWithTypes(types: Record<string, string> | null): EngineContext {
  return { ...makeFixture().ctx, customFieldTypes: types };
}

// Combined-field fixture: the channel lives on the opportunity, or else on its contact.
function makeComboFixture(): { ctx: EngineContext; o: Record<string, Opportunity> } {
  const contacts = [
    mkContact("c1"),
    mkContact("c2", { customFieldsResolved: { "Canal de Contacto": "Facebook" } }),
    mkContact("c3"),
  ];
  const o = {
    o1: mkOpp("o1", "c1", "p1", "Nuevo", "2026-10-01T12:00:00Z", { customFieldsResolved: { "Canal de contacto": "WhatsApp" } }),
    o2: mkOpp("o2", "c2", "p1", "Nuevo", "2026-10-02T12:00:00Z"),
    o3: mkOpp("o3", "c3", "p1", "Nuevo", "2026-10-03T12:00:00Z"),
    oBoth: mkOpp("oBoth", "c3", "p1", "Nuevo", "2026-10-04T12:00:00Z", { customFieldsResolved: { "Sucursal VAEO": "Tanarah", "Sucursal MESH": "Valle" } }),
    oMesh: mkOpp("oMesh", "c3", "p1", "Nuevo", "2026-10-05T12:00:00Z", { customFieldsResolved: { "Sucursal MESH": "Valle" } }),
  };
  const base = makeFixture().ctx;
  return { ctx: { ...base, dataset: { ...base.dataset, contacts, opportunities: Object.values(o) } }, o };
}

function semanticSection(): void {
  section("semantic: custom dates, combined fields, outcome, relative filters");

  check("dateValue reads epoch number, epoch string and ISO the same day", () => {
    const ctx = resolveCtx(fixtureWithTypes({ "opportunity:Fecha de Cierre": "DATE" }));
    for (const v of [1790812800000, "1790812800000", "2026-10-01T00:00:00.000Z"]) {
      const d = dateValue("opportunities", { customFieldsResolved: { "Fecha de Cierre": v } }, "cf:Fecha de Cierre", ctx);
      assert.ok(d, String(v));
      assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 9, 1], String(v));
    }
  });

  check("a TEXT custom field that looks like a date is not a date", () => {
    const ctx = fixtureWithTypes({ "contact:Fecha de última asignación": "TEXT" });
    assert.equal(isDateField("contacts", "cf:Fecha de última asignación", ctx), false);
    assert.equal(dateValue("contacts", { customFieldsResolved: { "Fecha de última asignación": "20/05/2026" } }, "cf:Fecha de última asignación", resolveCtx(ctx)), null);
  });

  check("unknown types (old cache) make custom dates unavailable", () => {
    assert.equal(isDateField("opportunities", "cf:Fecha de Cierre", fixtureWithTypes(null)), false);
    assert.equal(isDateField("opportunities", "cf:Fecha de Cierre", fixtureWithTypes({ "opportunity:fecha de cierre": "DATE" })), true);
  });

  check("stage and status change dates are opportunity dates; contact dates reach through", () => {
    const ctx = fixtureWithTypes({});
    assert.equal(isDateField("opportunities", "lastStageChangeAt", ctx), true);
    assert.equal(isDateField("opportunities", "lastStatusChangeAt", ctx), true);
    assert.equal(isDateField("appointments", "contact.createdAt", ctx), true);
    assert.equal(isDateField("contacts", "contact.createdAt", ctx), false);
  });

  check("fallbacks read the first filled field, crossing to the contact", () => {
    const { ctx, o } = makeComboFixture();
    const r = resolveCtx(ctx);
    const fields = ["cf:Canal de contacto", "contact.cf:Canal de Contacto"];
    assert.deepEqual(fieldValuesWithFallbacks("opportunities", o.o1 as unknown as Row, fields, r), ["WhatsApp"]);
    assert.deepEqual(fieldValuesWithFallbacks("opportunities", o.o2 as unknown as Row, fields, r), ["Facebook"]);
    assert.deepEqual(fieldValuesWithFallbacks("opportunities", o.o3 as unknown as Row, fields, r), [EMPTY_VALUE]);
  });

  check("fallback filter agrees with fallback grouping", () => {
    const { ctx, o } = makeComboFixture();
    const r = resolveCtx(ctx);
    const f = { field: "cf:Sucursal VAEO", op: "eq" as const, values: ["Valle"], fallbacks: ["cf:Sucursal MESH"] };
    assert.equal(matchesFilter("opportunities", o.oBoth as unknown as Row, f, r), false);
    assert.equal(matchesFilter("opportunities", o.oMesh as unknown as Row, f, r), true);
    assert.deepEqual(fieldValuesWithFallbacks("opportunities", o.oBoth as unknown as Row, ["cf:Sucursal VAEO", "cf:Sucursal MESH"], r), ["Tanarah"]);
  });

  check("outcome follows isWonOpp and folds abandoned into Perdida", () => {
    const base = mkOpp("x", "c1", "p1", "Nuevo", "2026-10-01T12:00:00Z");
    assert.equal(outcomeOf({ ...base, status: "open", stage: "Negocio Ganado" }), "Ganada");
    assert.equal(outcomeOf({ ...base, status: "won" }), "Ganada");
    assert.equal(outcomeOf({ ...base, status: "abandoned" }), "Perdida");
    assert.equal(outcomeOf({ ...base, status: "lost" }), "Perdida");
    assert.equal(outcomeOf({ ...base, status: "open" }), "Abierta");
  });

  check("days_ago filters count whole local days from ctx.now", () => {
    const ctx = resolveCtx(fixtureWithTypes({}));
    const opp = { ...mkOpp("s16", "c1", "p1", "Nuevo", "2026-09-01T12:00:00Z"), lastStageChangeAt: new Date(2026, 9, 13, 23, 0, 0).toISOString() } as unknown as Row;
    assert.equal(matchesFilter("opportunities", opp, { field: "lastStageChangeAt", op: "days_ago_gte", values: ["16"] }, ctx), true);
    assert.equal(matchesFilter("opportunities", opp, { field: "lastStageChangeAt", op: "days_ago_gte", values: ["17"] }, ctx), false);
    assert.equal(matchesFilter("opportunities", opp, { field: "lastStageChangeAt", op: "days_ago_lte", values: ["16"] }, ctx), true);
    const noDate = mkOpp("nd", "c1", "p1", "Nuevo", "2026-09-01T12:00:00Z") as unknown as Row;
    assert.equal(matchesFilter("opportunities", noDate, { field: "lastStageChangeAt", op: "days_ago_gte", values: ["1"] }, ctx), false);
  });
}

// ─── Task 4: age buckets, custom-date windows, margins ─────────────────────────

const ALL: TimeSpec = { field: "createdAt", range: "all", from: null, to: null, compare: "none" };
const WON: FilterClause = { anyOf: [{ field: "won", op: "eq", values: ["true"] }] };
const OCT1_UTC = "1790812800000"; // 2026-10-01T00:00:00Z, how GHL stores a DATE field

function makeCloseDateFixture(): EngineContext {
  const cf = (v?: string) => (v ? { customFieldsResolved: { "Fecha de Cierre": v } } : {});
  const opps = [
    mkOpp("oA", "c1", "p1", "Ganado", "2026-09-01T12:00:00Z", { status: "won", value: 1000, ...cf("1791158400000") }), // Oct 5
    mkOpp("oB", "c1", "p1", "Ganado", "2026-09-01T12:00:00Z", { status: "won", value: 2000, ...cf(OCT1_UTC) }),
    mkOpp("oC", "c2", "p1", "Ganado", "2026-09-01T12:00:00Z", { status: "won", value: 300 }),
    mkOpp("oD", "c2", "p1", "Ganado", "2026-09-01T12:00:00Z", { status: "won", value: 400 }),
    mkOpp("oE", "c3", "p1", "Ganado", "2026-09-01T12:00:00Z", { status: "won", value: 500, ...cf("1789430400000") }), // Sep 15
    mkOpp("oF", "c3", "p1", "Nuevo", "2026-09-01T12:00:00Z", { value: 900, ...cf("1791590400000") }), // Oct 10, open
  ];
  const base = makeFixture().ctx;
  return { ...base, dataset: { ...base.dataset, opportunities: opps }, customFieldTypes: { "opportunity:Fecha de Cierre": "DATE" } };
}

function makeAgeFixture(): EngineContext {
  const at = (daysAgo: number) => new Date(2026, 9, 29 - daysAgo, 10, 0, 0).toISOString(); // now = 2026-10-29 12:00 local
  const opps = [
    mkOpp("a3", "c1", "p1", "Nuevo", "2026-09-01T12:00:00Z", { lastStageChangeAt: at(3) }),
    mkOpp("a20", "c1", "p1", "Nuevo", "2026-09-01T12:00:00Z", { lastStageChangeAt: at(20) }),
    mkOpp("a90", "c2", "p1", "Nuevo", "2026-09-01T12:00:00Z", { lastStageChangeAt: at(90) }),
    mkOpp("aNone", "c2", "p1", "Nuevo", "2026-09-01T12:00:00Z"),
    mkOpp("aFuture", "c3", "p1", "Nuevo", "2026-09-01T12:00:00Z", { lastStageChangeAt: at(-2) }),
  ];
  const base = makeFixture().ctx;
  return { ...base, dataset: { ...base.dataset, opportunities: opps }, customFieldTypes: {} };
}

function engineDimsSection(): void {
  section("engine: age buckets, custom-date windows, margins");

  check("age buckets: 7/8, 15/16, 60/61 borders, future and missing", () => {
    const e = [7, 15, 30, 60];
    assert.deepEqual([0, 7, 8, 15, 16, 30, 31, 60, 61].map((d) => ageBucketKey(d, e)), ["a0", "a0", "a1", "a1", "a2", "a2", "a3", "a3", "a4"]);
    assert.equal(ageBucketKey(-1, e), "future");
    assert.equal(ageBucketKey(null, e), EMPTY_VALUE);
  });

  check("an age dimension shows every range even at zero, in order", () => {
    const res = runQuery(q({ groupBy: [{ dimension: "lastStageChangeAt", bucket: "age", join: null }], time: ALL }), makeAgeFixture());
    assert.deepEqual(res.rows.map((r) => r.label[0]), ["0–7 días", "8–15 días", "16–30 días", "31–60 días", "Más de 60 días", "Fecha futura", "Sin fecha"]);
    assert.deepEqual(res.rows.map((r) => r.values[0]), [1, 0, 1, 0, 1, 1, 1]);
  });

  check("custom date window drops undated rows and says how many", () => {
    const res = runQuery(
      q({ metrics: [{ metric: "value_sum", label: null }], filters: [WON], time: { field: "cf:Fecha de Cierre", range: "absolute", from: "2026-10-01", to: "2026-10-31", compare: "none" } }),
      makeCloseDateFixture()
    );
    assert.equal(res.totals[0], 3000);
    assert.ok(res.meta.warnings.includes("2 oportunidades sin «Fecha de Cierre» no aparecen"), res.meta.warnings.join(" | "));
    assert.equal(res.meta.undated?.records.length, 2);
  });

  check("a close date of Oct 1 00:00Z buckets in October; undated show last on an all-time axis", () => {
    const res = runQuery(q({ metrics: [{ metric: "value_sum", label: null }], filters: [WON], groupBy: [dim("cf:Fecha de Cierre", "month")], sort: { by: "natural", dir: "asc" }, time: ALL }), makeCloseDateFixture());
    const v = byLabel(res);
    assert.equal(v["oct 2026"], 3000);
    assert.equal(v["sep 2026"], 500);
    assert.equal(res.rows[res.rows.length - 1].label[0], "Sin Fecha de Cierre");
  });

  check("custom date with an old cache is pending, not an unknown field", () => {
    assert.throws(
      () => runQuery(q({ time: { ...ALL, field: "cf:Fecha de Cierre" } }), { ...makeCloseDateFixture(), customFieldTypes: null }),
      (e: unknown) => e instanceof QueryError && e.code === "pending" && /después de la próxima actualización/.test(e.message)
    );
  });

  check("margins measure deduped records, not summed cells", () => {
    const base = makeFixture().ctx;
    const contacts = [mkContact("m1", { assignedTo: "Ana", tags: ["vip", "b"] }), mkContact("m2", { assignedTo: "Ana", tags: ["vip"] })];
    const res = runQuery(q({ source: "contacts", groupBy: [dim("assignedTo"), dim("tags")], time: ALL }), { ...base, dataset: { ...base.dataset, contacts } });
    assert.equal(res.margins!.first["Ana"][0], 2);
    assert.equal(res.margins!.second["vip"][0], 2);
    assert.equal(res.margins!.second["b"][0], 1);
    assert.equal(runQuery(q({ source: "contacts", groupBy: [dim("assignedTo")], time: ALL }), base).margins, null);
  });

  check("outcome stacks in Ganada, Abierta, Perdida order", () => {
    const base = makeFixture().ctx;
    const opps = [
      mkOpp("l1", "c1", "p1", "Nuevo", "2026-10-01T12:00:00Z", { status: "lost" }),
      mkOpp("l2", "c1", "p1", "Nuevo", "2026-10-02T12:00:00Z", { status: "abandoned" }),
      mkOpp("w1", "c2", "p1", "Nuevo", "2026-10-03T12:00:00Z", { status: "won" }),
      mkOpp("op", "c3", "p1", "Nuevo", "2026-10-04T12:00:00Z"),
    ];
    const res = runQuery(q({ groupBy: [dim("createdAt", "month"), dim("outcome")], time: ALL }), { ...base, dataset: { ...base.dataset, opportunities: opps } });
    assert.deepEqual(res.rows.map((r) => r.label[1]), ["Ganada", "Abierta", "Perdida"]);
    assert.deepEqual(res.rows.map((r) => r.values[0]), [1, 1, 2]);
  });
}

// ─── Task 5: several series and proportions ───────────────────────────────────

const OCT: TimeSpec = { field: "createdAt", range: "absolute", from: "2026-10-01", to: "2026-10-31", compare: "none" };
const ANY_OPP: RelatedFilterSpec = { entity: "opportunity", quantifier: "any", conditions: [] };
const NONE_OPP: RelatedFilterSpec = { entity: "opportunity", quantifier: "none", conditions: [] };

function series(label: string, source: SourceId, metric: MetricId, dateField: string, extra: Partial<SeriesSpec> = {}): SeriesSpec {
  return { label, source, metric, filters: [], relatedFilters: [], dateField, dimension: null, ...extra };
}

// k1 Oct 2 (opp Oct 3), k2 Oct 9 (opp Sep 1), k3 Oct 9 (no opp), k9 Oct 20 (opp Nov 2, after the window).
function makeSeriesFixture(): EngineContext {
  const base = makeFixture().ctx;
  const contacts = [
    mkContact("k1", { createdAt: "2026-10-02T15:00:00Z" }),
    mkContact("k2", { createdAt: "2026-10-09T15:00:00Z" }),
    mkContact("k3", { createdAt: "2026-10-09T16:00:00Z" }),
    mkContact("k9", { createdAt: "2026-10-20T15:00:00Z" }),
  ];
  const opps = [
    mkOpp("pk1", "k1", "p1", "Nuevo", "2026-10-03T15:00:00Z"),
    mkOpp("pk2", "k2", "p2", "Nuevo", "2026-09-01T15:00:00Z"),
    mkOpp("pk9", "k9", "p1", "Nuevo", "2026-11-02T15:00:00Z"),
  ];
  return { ...base, now: new Date(2026, 10, 10, 12, 0, 0), dataset: { ...base.dataset, contacts, opportunities: opps } };
}

function seriesSection(): void {
  section("engine: several series and proportions");
  const ctx = makeSeriesFixture();

  check("contacts and opportunities created per week share one axis", () => {
    const res = runQuery(q({ source: "contacts", groupBy: [dim("createdAt", "week")], series: [series("Oportunidades", "opportunities", "count", "createdAt")], time: OCT }), ctx);
    assert.deepEqual(res.meta.seriesLabels, ["Contactos", "Oportunidades"]);
    assert.deepEqual(res.totals, [4, 1]);
    assert.equal(res.meta.valueKind, "count");
    const week5 = res.rows.filter((r) => r.key[0] === "2026-10-05");
    assert.deepEqual(week5.map((r) => [r.label[1], r.values[0]]), [["Contactos", 2], ["Oportunidades", 0]]);
  });

  check("same-group proportion counts the condition over all time (cohort)", () => {
    const res = runQuery(
      q({ source: "contacts", series: [series("Con oportunidad", "contacts", "count", "createdAt", { relatedFilters: [ANY_OPP] })], ratio: { label: "% con oportunidad", numerator: 1, denominator: 0 }, time: OCT }),
      ctx
    );
    assert.equal(res.meta.ratio!.kind, "same_group");
    assert.deepEqual(res.meta.ratio!.parts, [3, 4]);
    assert.equal(res.totals[0], 0.75);
    assert.equal(res.meta.valueKind, "rate");
    assert.ok(res.meta.warnings.includes("Cuenta hasta hoy: los periodos recientes siguen madurando."), res.meta.warnings.join(" | "));
  });

  check("between-series ratio says they are not the same records", () => {
    const res = runQuery(q({ source: "opportunities", metrics: [{ metric: "count", label: "Oportunidades" }], series: [series("Contactos", "contacts", "count", "createdAt")], ratio: { label: "Opps por contacto", numerator: 0, denominator: 1 }, time: OCT }), ctx);
    assert.equal(res.meta.ratio!.kind, "between_series");
    assert.deepEqual(res.meta.ratio!.parts, [1, 4]);
    assert.ok(res.meta.warnings.includes("«Oportunidades» y «Contactos» no son los mismos registros: el cociente compara ritmos, no es una conversión."), res.meta.warnings.join(" | "));
  });

  check("ratio with zero denominator is null", () => {
    const res = runQuery(q({ source: "opportunities", groupBy: [dim("createdAt", "week")], series: [series("Contactos", "contacts", "count", "createdAt")], ratio: { label: "Opps por contacto", numerator: 0, denominator: 1 }, time: OCT }), ctx);
    const wk12 = res.rows.find((r) => r.key[0] === "2026-10-12")!;
    assert.equal(wk12.values[0], null);
    assert.deepEqual(wk12.parts, [0, 0]);
    const empty = runQuery(q({ source: "opportunities", series: [series("Contactos", "contacts", "count", "createdAt")], ratio: { label: "x", numerator: 0, denominator: 1 }, time: { ...OCT, from: "2026-01-01", to: "2026-01-31" } }), ctx);
    assert.deepEqual(empty.totals, [null]);
  });

  check("mixed units are refused", () => {
    assert.throws(() => runQuery(q({ series: [series("Valor", "opportunities", "value_sum", "createdAt")], time: OCT }), ctx), /mezclan unidades/);
  });

  check("has-opportunity contact queries ignore the pipeline filter and say so", () => {
    const res = runQuery(q({ source: "contacts", relatedFilters: [NONE_OPP], time: ALL }), { ...ctx, pipelineFilter: ["p1"] });
    assert.equal(res.totals[0], 1);
    assert.equal(res.meta.pipelineIgnored, true);
    assert.ok(res.meta.warnings.includes("Ignora el filtro de pipeline: con él, todos los contactos tendrían oportunidad."));
    const plain = runQuery(q({ source: "contacts", relatedFilters: [NONE_OPP], time: ALL }), ctx);
    assert.equal(plain.meta.pipelineIgnored, undefined);
  });

  check("a single-source widget still returns exactly what it did", () => {
    const res = runQuery(q({ groupBy: [dim("stage")], time: ALL }), makeFixture().ctx);
    assert.deepEqual(byLabel(res), { "Primera Cita": 1, Propuesta: 1, "Negocio Ganado": 1, Seguimiento: 1 });
    assert.equal(res.meta.seriesLabels, undefined);
  });
}

// ─── Task 6: validation ───────────────────────────────────────────────────────

function widget(viz: VizType, over: Partial<QuerySpec>): WidgetSpec {
  return { ...(LEGACY_KPI as WidgetSpec), viz, size: "m", height: "normal", query: q({ source: "contacts", time: ALL, ...over }) };
}

function validateSection(): void {
  section("validate: series, matrix, age, combined fields, conversations");
  const cat = buildCatalog({ ...makeComboFixture().ctx, customFieldTypes: { "opportunity:Fecha de Cierre": "DATE" } });
  const catOld = buildCatalog({ ...makeComboFixture().ctx, customFieldTypes: null });
  const opps = series("Oportunidades", "opportunities", "count", "createdAt");
  const weekly = { groupBy: [dim("createdAt", "week")], series: [opps] };
  const one = (spec: WidgetSpec, path: string, re: RegExp) => {
    const issues = validateWidget(spec, cat);
    assert.equal(issues.length, 1, JSON.stringify(issues));
    assert.equal(issues[0].path, path);
    assert.match(issues[0].message, re);
  };

  check("valid multi-series and ratio widgets have no issues", () => {
    assert.deepEqual(validateWidget(widget("grouped_bar", weekly), cat), []);
    assert.deepEqual(validateWidget(widget("line", weekly), cat), []);
    assert.deepEqual(validateWidget(widget("kpi", { series: [series("Con oportunidad", "contacts", "count", "createdAt", { relatedFilters: [ANY_OPP] })], ratio: { label: "%", numerator: 1, denominator: 0 } }), cat), []);
  });
  check("stacked bars across sources are refused", () => one(widget("stacked_bar", weekly), "viz", /no se apilan series de fuentes distintas/));
  check("a kpi with two series and no ratio is refused", () => one(widget("kpi", { series: [opps] }), "viz", /necesita una proporción/));
  check("series take one axis only", () => one(widget("grouped_bar", { ...weekly, groupBy: [dim("createdAt", "week"), dim("source")] }), "query.groupBy", /solo hay un eje/));
  check("a series date must be a date of its source", () => one(widget("grouped_bar", { ...weekly, series: [{ ...opps, dateField: "startTime" }] }), "query.series[0].dateField", /no es una fecha de opportunities/));
  check("a category axis must exist in every series", () =>
    one(widget("grouped_bar", { groupBy: [dim("city")], series: [opps] }), "query.series[0].dimension", /city/));
  check("mixed units without a ratio are refused", () =>
    one(widget("grouped_bar", { ...weekly, series: [{ ...opps, metric: "value_sum" }] }), "query.series", /mezclan unidades/));
  check("no previous-period comparison with series", () =>
    one(widget("grouped_bar", { ...weekly, time: { ...ALL, compare: "previous_period" } }), "query.time.compare", /varias series/));
  check("ratio indexes must exist and differ", () =>
    one(widget("kpi", { series: [opps], ratio: { label: "%", numerator: 2, denominator: 0 } }), "query.ratio", /no existen/));
  check("a matrix needs exactly two dimensions and one metric", () => one(widget("matrix", { groupBy: [dim("source")] }), "viz", /2 dimensiones/));
  check("age on a non-date is refused", () => one(widget("bar", { groupBy: [{ dimension: "source", bucket: "age", join: null }] }), "query.groupBy[0]", /no es una fecha/));
  check("an unknown fallback field is refused", () =>
    one(widget("bar", { source: "opportunities", groupBy: [{ ...dim("cf:Canal de contacto"), fallbacks: ["contact.cf:Canal Inexistente"] }] }), "query.groupBy[0].fallbacks[0]", /Canal Inexistente/));
  check("a fallback to the contact is accepted", () =>
    assert.deepEqual(validateWidget(widget("bar", { source: "opportunities", groupBy: [{ ...dim("cf:Canal de contacto"), fallbacks: ["contact.cf:Canal de Contacto"] }] }), cat), []));
  check("conversations take no related filters", () =>
    one(widget("kpi", { source: "conversations", time: { ...ALL, field: "lastMessageAt" }, relatedFilters: [ANY_OPP] }), "query.relatedFilters", /conversaciones/i));
  check("a custom date is a valid period when GHL types it DATE, pending on an old cache", () => {
    const spec = widget("kpi", { source: "opportunities", time: { ...OCT, field: "cf:Fecha de Cierre" } });
    assert.deepEqual(validateWidget(spec, cat), []);
    const issues = validateWidget(spec, catOld);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /después de la próxima actualización/);
  });
}

// ─── Task 7: the conversation index (pure part) ───────────────────────────────

function convRow(over: Partial<ConversationRow>): ConversationRow {
  return {
    id: "cv",
    contactId: "c1",
    channel: "WhatsApp",
    assignedTo: null,
    lastMessageAt: null,
    lastDirection: null,
    unreadCount: 0,
    createdAt: null,
    lastOutboundAt: null,
    waitingReply: false,
    ...over,
  };
}

function conversationIndexSection(): void {
  section("conversations: pure index");
  const NOW = Date.UTC(2026, 9, 29, 12);
  const CUTOFF = NOW - 60 * 86_400_000;
  const recent = new Date(NOW - 2 * 86_400_000).toISOString();
  const old = new Date(NOW - 90 * 86_400_000).toISOString();

  check("toIso reads epoch number, numeric string and ISO", () => {
    assert.equal(toIso(1786082787710), new Date(1786082787710).toISOString());
    assert.equal(toIso("1786082787710"), new Date(1786082787710).toISOString());
    assert.equal(toIso("2026-10-01T10:00:00.000Z"), "2026-10-01T10:00:00.000Z");
    assert.equal(toIso(""), null);
    assert.equal(toIso(undefined), null);
    assert.equal(toIso("no es fecha"), null);
  });

  check("a conversation ending outbound needs no thread; inbound inside the window does", () => {
    assert.equal(needsThread("outbound", recent, CUTOFF), false);
    assert.equal(needsThread("inbound", recent, CUTOFF), true);
    assert.equal(needsThread("inbound", old, CUTOFF), false);
    assert.equal(needsThread(null, recent, CUTOFF), true);
  });

  check("last outbound skips activities and counts automated messages", () => {
    const out = { direction: "outbound", dateAdded: "2026-10-20T10:00:00.000Z", messageType: "TYPE_WHATSAPP", source: "workflow" };
    const activity = { direction: "outbound", dateAdded: "2026-10-25T10:00:00.000Z", messageType: "TYPE_ACTIVITY_OPPORTUNITY" };
    const inbound = { direction: "inbound", dateAdded: "2026-10-26T10:00:00.000Z", messageType: "TYPE_WHATSAPP" };
    assert.equal(lastOutboundFrom([out, activity, inbound]), "2026-10-20T10:00:00.000Z");
    assert.equal(lastOutboundFrom([inbound]), null);
  });

  check("channel labels are Spanish and fall back to Otro", () => {
    assert.equal(channelLabel("TYPE_WHATSAPP"), "WhatsApp");
    assert.equal(channelLabel("TYPE_EMAIL"), "Correo");
    assert.equal(channelLabel("TYPE_SOMETHING_NEW"), "Otro");
    assert.equal(channelLabel(undefined), "Otro");
  });

  check("contact dates take the max across conversations", () => {
    const m = contactMessageDates([
      convRow({ id: "a", lastMessageAt: "2026-10-10T00:00:00.000Z", lastOutboundAt: "2026-10-10T00:00:00.000Z" }),
      convRow({ id: "b", lastMessageAt: "2026-10-20T00:00:00.000Z", lastOutboundAt: "2026-10-05T00:00:00.000Z" }),
      convRow({ id: "c", contactId: "c2", lastMessageAt: "2026-10-01T00:00:00.000Z" }),
    ]);
    assert.deepEqual(m.get("c1"), { lastOutboundAt: "2026-10-10T00:00:00.000Z", lastMessageAt: "2026-10-20T00:00:00.000Z" });
    assert.deepEqual(m.get("c2"), { lastOutboundAt: null, lastMessageAt: "2026-10-01T00:00:00.000Z" });
  });
}

async function main(): Promise<void> {
  specSection();
  syncSection();
  semanticSection();
  engineDimsSection();
  seriesSection();
  validateSection();
  conversationIndexSection();
  console.log("\n✅ capabilities — all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
