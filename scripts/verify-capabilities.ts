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
import { section, check, q } from "./lib/widget-test-kit";

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

async function main(): Promise<void> {
  specSection();
  console.log("\n✅ capabilities — all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
