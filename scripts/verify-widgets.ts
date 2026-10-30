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
import type { Opportunity, Pauta } from "../lib/types";

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

function main(): void {
  specSection();
  domainSection();
  console.log("\n✅ lib/widgets — all assertions passed");
}

main();
