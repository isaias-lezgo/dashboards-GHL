// Semantic validation of a widget spec, run in the browser before anything is
// saved. zod (spec.ts) guarantees the SHAPE; this checks MEANING against the
// account's real data — does the field exist here, does the chart fit the query,
// is the metric defined for this source. Issues go back to the model as an
// is_error tool_result with a suggested fix, so it corrects itself like a
// compiler loop instead of saving a widget that renders zero.
import type { AdsStatus } from "@/lib/types";
import { SOURCE_ENTITY, type EntityId, type FilterClause, type SourceId, type WidgetSpec } from "./spec";
import { metricAllowed } from "./metrics";
import {
  DERIVED_FIELDS,
  ENTITY_FIELDS,
  ENTITY_SOURCE,
  NATIVE_FIELDS,
  SOURCE_DEFS,
  isDateField,
  isRelatedDimension,
  knownCustomFields,
  type EngineContext,
} from "./semantic";

export interface Catalog {
  /** Readable fields per source: native, derived and "cf:<Name>" custom fields. */
  fields: Record<SourceId, Set<string>>;
  customFields: Record<"contacts" | "opportunities", Set<string>>;
  stages: string[];
  pipelineNames: string[];
  apptStatuses: string[];
  adsStatus: AdsStatus | "pending";
}

export interface ValidationIssue {
  path: string;
  message: string;
  suggestion: string | null;
}

const ALL_SOURCES: SourceId[] = ["contacts", "opportunities", "appointments", "tasks", "pautas", "ads_daily"];

export function buildCatalog(ctx: EngineContext): Catalog {
  const customFields = {
    contacts: knownCustomFields("contacts", ctx),
    opportunities: knownCustomFields("opportunities", ctx),
  };
  const fields = {} as Record<SourceId, Set<string>>;
  for (const s of ALL_SOURCES) {
    const set = new Set<string>([...NATIVE_FIELDS[s], ...(DERIVED_FIELDS[s] ?? [])]);
    if (s === "contacts" || s === "opportunities") for (const cf of customFields[s]) set.add(`cf:${cf}`);
    fields[s] = set;
  }
  const stages: string[] = [];
  const pipelineNames: string[] = [];
  for (const p of ctx.pipelines) {
    pipelineNames.push(p.name);
    for (const st of p.stages) if (!stages.includes(st)) stages.push(st);
  }
  const apptStatuses = [...new Set(ctx.dataset.appointments.map((a) => a.status))].sort();
  return {
    fields,
    customFields,
    stages,
    pipelineNames,
    apptStatuses,
    adsStatus: ctx.ads ? ctx.ads.status : "pending",
  };
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/**
 * The closest known field: one that contains (or is contained in) the typed
 * name — "cf:Origen" → "cf:Origen de Lead" — or, failing that, one within a
 * normalized edit distance of 0.4. Case- and accent-insensitive.
 */
export function suggestField(typed: string, known: Iterable<string>): string | null {
  const t = norm(typed);
  let best: { field: string; score: number } | null = null;
  for (const k of known) {
    const n = norm(k);
    let score: number;
    if (n === t) return k;
    if (t.length >= 3 && (n.includes(t) || t.includes(n))) score = 0.1 + Math.abs(n.length - t.length) / 1000;
    else score = editDistance(t, n) / Math.max(t.length, n.length);
    if (score <= 0.4 && (!best || score < best.score)) best = { field: k, score };
  }
  return best?.field ?? null;
}

// ─── Rules ────────────────────────────────────────────────────────────────────

function entityFields(entity: EntityId, catalog: Catalog): Set<string> {
  const source = ENTITY_SOURCE[entity];
  const set = new Set<string>(ENTITY_FIELDS[entity].map((f) => f.field));
  for (const f of catalog.fields[source]) set.add(f);
  return set;
}

/** The issue for a field this account does not have, with the closest real one; null when it exists. */
function fieldIssue(path: string, field: string, known: Set<string>, where: string): ValidationIssue | null {
  if (known.has(field)) return null;
  if (field.startsWith("cf:")) {
    const target = field.slice(3).trim().toLowerCase();
    for (const k of known) if (k.toLowerCase() === `cf:${target}`) return null;
  }
  const suggestion = suggestField(field, known);
  return { path, message: `El campo «${field}» no existe en ${where}${suggestion ? `; ¿quisiste «${suggestion}»?` : "."}`, suggestion };
}

/**
 * Fields of clauses that stand on their own — a glossary meaning, a condition
 * control, a filter chip — checked against the object's fields with the same
 * rules and suggestions as a widget's filters.
 */
export function validateEntityClauses(entity: EntityId, clauses: FilterClause[], catalog: Catalog, basePath: string): ValidationIssue[] {
  const known = entityFields(entity, catalog);
  const out: ValidationIssue[] = [];
  clauses.forEach((c, i) =>
    c.anyOf.forEach((f, j) => {
      const issue = fieldIssue(`${basePath}[${i}].anyOf[${j}].field`, f.field, known, ENTITY_SOURCE[entity]);
      if (issue) out.push(issue);
    })
  );
  return out;
}

/** One field of an object (a filter control's field). */
export function validateEntityField(entity: EntityId, field: string, catalog: Catalog, path: string): ValidationIssue | null {
  return fieldIssue(path, field, entityFields(entity, catalog), ENTITY_SOURCE[entity]);
}

export function validateWidget(spec: WidgetSpec, catalog: Catalog): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const q = spec.query;
  if (!q) return issues; // a text note: zod already enforced its shape
  const add = (path: string, message: string, suggestion: string | null = null) => issues.push({ path, message, suggestion });
  const own = catalog.fields[q.source];

  const checkField = (path: string, field: string, known: Set<string>, where: string) => {
    const issue = fieldIssue(path, field, known, where);
    if (issue) issues.push(issue);
  };

  // Metrics
  q.metrics.forEach((m, i) => {
    if (!metricAllowed(m.metric, q.source)) add(`query.metrics[${i}]`, `La métrica «${m.metric}» no está definida para ${q.source}.`);
  });

  // Time
  if (!SOURCE_DEFS[q.source].dateFields.includes(q.time.field)) {
    add("query.time.field", `«${q.time.field}» no es una fecha de ${q.source}; usa una de: ${SOURCE_DEFS[q.source].dateFields.join(", ")}.`);
  }
  if (q.time.range === "absolute" && !q.time.from) add("query.time.from", "Un periodo absoluto necesita `from`.");

  // Dimensions
  q.groupBy.forEach((g, i) => {
    const path = `query.groupBy[${i}]`;
    const related = isRelatedDimension(g.dimension);
    if (related) {
      const [prefix, ...rest] = g.dimension.split(".");
      const target: SourceId = prefix === "contact" ? "contacts" : "opportunities";
      if (target === q.source || q.source === "ads_daily") {
        add(path, `«${g.dimension}» no aplica a ${q.source}: usa el campo propio.`);
      } else {
        checkField(path, rest.join("."), catalog.fields[target], target);
      }
      if (g.bucket) add(path, "`bucket` solo aplica a dimensiones de fecha.");
      return;
    }
    if (g.join) add(path, "`join` solo aplica a dimensiones «opportunity.*» o «contact.*».");
    if (isDateField(q.source, g.dimension)) {
      if (!g.bucket) add(path, `Agrupar por «${g.dimension}» necesita un bucket (day, week, month…).`);
      if (q.source === "ads_daily" && (g.bucket === "weekday" || g.bucket === "hour")) {
        add(path, "El gasto de Meta solo se agrupa por día, semana, mes o trimestre.");
      }
      return;
    }
    if (g.bucket) add(path, `«${g.dimension}» no es una fecha: quita el bucket.`);
    if (q.source === "ads_daily") {
      add(path, "El gasto de Meta solo se agrupa por la fecha («date»).");
      return;
    }
    checkField(path, g.dimension, own, q.source);
  });

  // Filters
  const checkClauses = (base: string, clauses: FilterClause[], known: Set<string>, where: string) =>
    clauses.forEach((c, i) => c.anyOf.forEach((f, j) => checkField(`${base}[${i}].anyOf[${j}].field`, f.field, known, where)));
  if (q.source === "ads_daily") {
    if (q.filters.length || q.relatedFilters.length) {
      add("query.filters", "El gasto de Meta no admite filtros de CRM: Meta no tiene pipeline, asesor ni etapa.");
    }
  } else {
    const sourceEntity = SOURCE_ENTITY[q.source];
    checkClauses("query.filters", q.filters, own, q.source);
    q.relatedFilters.forEach((rf, i) => {
      const path = `query.relatedFilters[${i}]`;
      if (rf.entity === sourceEntity) {
        add(path, `«${rf.entity}» es el mismo objeto de la fuente: usa \`filters\`, no \`relatedFilters\`.`);
        return;
      }
      checkClauses(`${path}.conditions`, rf.conditions, entityFields(rf.entity, catalog), ENTITY_SOURCE[rf.entity]);
    });
  }

  // Chart ↔ query shape
  const dims = q.groupBy.length;
  const firstIsDate = dims > 0 && !isRelatedDimension(q.groupBy[0].dimension) && isDateField(q.source, q.groupBy[0].dimension);
  switch (spec.viz) {
    case "kpi":
      if (dims !== 0) add("viz", "Un KPI no lleva dimensiones: quita groupBy o usa barras.");
      break;
    case "line":
    case "area":
      if (!firstIsDate) add("viz", `Una gráfica de ${spec.viz === "line" ? "línea" : "área"} necesita una fecha con bucket como primera dimensión.`);
      if (spec.viz === "area" && dims > 1) add("viz", "Área solo con una serie: usa línea para varias.");
      break;
    case "funnel": {
      const d = q.groupBy[0]?.dimension;
      if (q.source !== "opportunities" || dims !== 1 || (d !== "funnelState" && d !== "stage")) {
        add("viz", "Un embudo es de oportunidades agrupadas por «funnelState» (o «stage»).");
      }
      break;
    }
    case "stacked_bar":
    case "grouped_bar":
      if (dims !== 2) add("viz", "Las barras apiladas o agrupadas necesitan 2 dimensiones (categoría y serie).");
      break;
    case "record_list":
      if (dims !== 0) add("viz", "Una lista de registros no lleva dimensiones.");
      if (q.limit === null) add("query.limit", "Una lista de registros necesita `limit` (máximo 50).");
      break;
    case "bar":
    case "bar_horizontal":
    case "table":
      if (dims === 0) add("viz", `«${spec.viz}» necesita al menos una dimensión; para un solo número usa kpi.`);
      break;
  }
  if (q.metrics.some((m) => m.metric === "cpl") && q.source !== "ads_daily") {
    add("query.source", "El costo por lead (cpl) usa la fuente «ads_daily».");
  }
  return issues;
}
