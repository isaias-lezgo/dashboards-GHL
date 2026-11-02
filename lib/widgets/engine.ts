// The AI panel's query engine: runs a validated QuerySpec over the dataset the
// browser already holds and returns grouped, measured rows plus the records
// behind each row (for drill-downs). Pure, deterministic, client-safe.
//
// Nothing the model writes reaches a chart without passing through here: the
// model chooses a query, this computes the numbers. Every number therefore has
// one implementation, shared with the AI assistant's aggregate tool (Task 11).
import {
  addDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachQuarterOfInterval,
  eachWeekOfInterval,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  format,
  getISODay,
  getQuarter,
  parseISO,
  startOfDay,
  startOfISOWeek,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subYears,
  differenceInCalendarDays,
} from "date-fns";
import { es } from "date-fns/locale";
import type { AdsStatus, Opportunity } from "@/lib/types";
import type { ResolvedDateRange } from "@/lib/date-range";
import { contactIdsInPipelines, filterByContactIds, filterOpportunitiesByPipelines } from "@/lib/pipeline-filter";
import { APPT_STATUS_ORDER } from "@/lib/appointment-status";
import { DOC_LIMITS, conversationDaysOf, edgesOf, entityOf, fallbacksOf, seriesOf, type Bucket, type SeriesSpec, type EntityId, type GroupBySpec, type MetricId, type QuerySpec, type SourceId, type TimeSpec } from "./spec";
import { METRICS, type MetricCtx } from "./metrics";
import { adsRowsFor, clippedWarning, pautaLeadDays } from "./ads-metrics";
import { ENUM_LABELS_ES, METRIC_PHRASES, SOURCE_LABELS, fieldLabel } from "./labels";
import { customFieldName } from "@/lib/custom-fields";
import { catLabel } from "@/lib/source-platform";
import {
  ENTITY_SOURCE,
  EMPTY_VALUE,
  QueryError,
  SOURCE_DEFS,
  MESSAGE_DATE_FIELDS,
  OUTCOME_ORDER,
  clauseFields,
  isMessageDateField,
  messageDate,
  customFieldType,
  dateValue,
  dimensionValues,
  fieldValuesWithFallbacks,
  isDateField,
  toDate,
  isKnownField,
  isRelatedDimension,
  matchesAll,
  matchesClause,
  matchesRelated,
  resolveCtx,
  type ActiveGlobalFilter,
  type EngineContext,
  type ResolvedCtx,
} from "./semantic";

type Row = Record<string, unknown>;

export interface QueryRow {
  key: string[];
  label: string[];
  values: (number | null)[];
  records: Row[];
  /** Ratio rows: [numerator, denominator] behind the value ("X de Y"). */
  parts?: [number | null, number | null];
}

export type ValueKind = "count" | "amount" | "rate";

export interface QueryMeta {
  source: SourceId;
  recordCount: number;
  range: { from: string; to: string } | null;
  bucketUsed: Bucket | null;
  foldedIntoOtros: number;
  seriesFolded: number;
  /** A record counted in more than one group (multi-valued fields, join "each"). */
  fanOut: boolean;
  crmFiltersIgnored: boolean;
  /** Labels of global filters a widget-level filter on the same field replaced ("pipeline" for the pipeline). */
  overriddenGlobals: string[];
  warnings: string[];
  adsStatus: AdsStatus | "pending" | null;
  adsMessage: string | null;
  /** A windowed custom date left these records out (they have no date). */
  undated?: { field: string; records: Row[] };
  /** A contacts query about having (or not) an opportunity ran without the panel's pipeline filter. */
  pipelineIgnored?: true;
  /** Multi-series widgets: one label per series, in index order (0 = the query itself). */
  seriesLabels?: string[];
  /** How values read when several metrics meet in one chart (series or a ratio). */
  valueKind?: ValueKind;
  /** Widgets that read conversations: where the on-demand load stands. */
  conversations?: {
    status: "loading" | "error" | "ready";
    days: number;
    scanned?: number;
    threads?: number;
    message?: string;
    truncated?: boolean;
  };
  ratio?: {
    kind: "same_group" | "between_series";
    numeratorLabel: string;
    denominatorLabel: string;
    parts: [number | null, number | null];
  };
}

export interface QueryResult {
  rows: QueryRow[];
  /**
   * 2-dimension results only: each first-dim and second-dim key measured over its
   * DEDUPED records — not the sum of its cells, which double-counts a record that
   * sits in several cells (tags, multi-option fields). Matrix totals read these.
   */
  margins: { first: Record<string, (number | null)[]>; second: Record<string, (number | null)[]> } | null;
  totals: (number | null)[];
  compare: { totals: (number | null)[]; range: { from: string; to: string } } | null;
  meta: QueryMeta;
}

export const OTROS = "Otros";
const OTROS_KEY = "__otros__";
const KEY_SEP = "\u0000";

// ─── Date ranges ──────────────────────────────────────────────────────────────

/**
 * The window a widget looks at. "inherit" follows the panel's date filter;
 * presets are computed on ctx.now in local time, the same day boundaries
 * resolveDateRange (lib/date-range.ts) uses; "all" is no window at all.
 */
export function resolveWidgetRange(time: TimeSpec, ctx: EngineContext): ResolvedDateRange | null {
  const now = ctx.now;
  const today = endOfDay(now);
  switch (time.range) {
    case "inherit":
      return ctx.dateRange;
    case "all":
      return null;
    case "absolute": {
      if (!time.from) return null;
      const from = parseISO(time.from);
      const to = parseISO(time.to ?? time.from);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new QueryError("invalid", "Fechas del periodo inválidas");
      }
      return { from: startOfDay(from), to: endOfDay(to) };
    }
    case "today":
      return { from: startOfDay(now), to: today };
    case "last_7d":
      return { from: startOfDay(subDays(now, 7)), to: today };
    case "last_30d":
      return { from: startOfDay(subDays(now, 30)), to: today };
    case "last_90d":
      return { from: startOfDay(subDays(now, 90)), to: today };
    case "this_week":
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case "this_month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "last_month": {
      const prev = subMonths(now, 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case "this_quarter":
      return { from: startOfQuarter(now), to: endOfQuarter(now) };
    case "ytd":
      return { from: startOfYear(now), to: today };
    case "next_7d":
      return { from: startOfDay(now), to: endOfDay(addDays(now, 7)) };
    case "next_30d":
      return { from: startOfDay(now), to: endOfDay(addDays(now, 30)) };
  }
}

const dayKey = (d: Date): string => format(d, "yyyy-MM-dd");
const rangeKeys = (r: ResolvedDateRange | null) => (r ? { from: dayKey(r.from), to: dayKey(r.to) } : null);

function applyRange(
  source: SourceId,
  field: string,
  rows: Row[],
  range: ResolvedDateRange | null,
  ctx: ResolvedCtx
): { rows: Row[]; undated: Row[] } {
  if (!range) return { rows, undated: [] };
  // Undated rows stay when the field is the source's own date (parity with
  // filterByDateRange); a secondary date (closedAt, dueDate…) that is missing
  // means the event never happened, so the row is out (parity with closedAfter).
  const keepUndated = SOURCE_DEFS[source].primaryDate === field;
  const from = range.from.getTime();
  const to = range.to.getTime();
  const undated: Row[] = [];
  const kept = rows.filter((r) => {
    const d = dateValue(source, r, field, ctx);
    if (!d) {
      if (!keepUndated) undated.push(r);
      return keepUndated;
    }
    const t = d.getTime();
    return t >= from && t <= to;
  });
  return { rows: kept, undated };
}

const SOURCE_NOUN: Record<SourceId, [string, string]> = {
  contacts: ["contacto", "contactos"],
  opportunities: ["oportunidad", "oportunidades"],
  appointments: ["cita", "citas"],
  tasks: ["tarea", "tareas"],
  pautas: ["pauta", "pautas"],
  ads_daily: ["día", "días"],
  conversations: ["conversación", "conversaciones"],
};

/** "2 oportunidades sin «Fecha de Cierre» no aparecen" — a windowed custom date says what it left out. */
function undatedWarning(source: SourceId, field: string, n: number): string {
  const [one, many] = SOURCE_NOUN[source];
  const name = customFieldName(field) ?? fieldLabel(field);
  return n === 1 ? `1 ${one} sin «${name}» no aparece` : `${n} ${many} sin «${name}» no aparecen`;
}

// ─── Global filters ───────────────────────────────────────────────────────────

interface GlobalPlan {
  applyPipeline: boolean;
  active: ActiveGlobalFilter[];
  overridden: string[];
  pipelineIgnored: boolean;
}

/** Which global filters apply to this widget, honoring "the widget's own filter on the same field wins". */
function globalPlan(q: QuerySpec, ctx: EngineContext): GlobalPlan {
  if (q.source === "ads_daily" || q.globalFilters === "ignore") return { applyPipeline: false, active: [], overridden: [], pipelineIgnored: false };
  const own = new Map<EntityId, Set<string>>();
  const add = (entity: EntityId, fields: string[]) => {
    const set = own.get(entity) ?? new Set<string>();
    for (const f of fields) set.add(f);
    own.set(entity, set);
  };
  const sourceEntity = entityOf(q.source);
  if (sourceEntity) for (const c of q.filters) add(sourceEntity, clauseFields(c));
  for (const rf of q.relatedFilters) for (const c of rf.conditions) add(rf.entity, clauseFields(c));

  const overridden: string[] = [];
  let applyPipeline = ctx.pipelineFilter.length > 0;
  const oppFields = own.get("opportunity");
  if (applyPipeline && oppFields && (oppFields.has("pipelineId") || oppFields.has("pipelineName"))) {
    applyPipeline = false;
    overridden.push("pipeline");
  }
  // "Contactos sin oportunidad" under a pipeline filter would always be 0 (the
  // filter keeps only contacts WITH an opportunity in it), "% con oportunidad"
  // always 100%: these cards ignore it and say so.
  let pipelineIgnored = false;
  if (applyPipeline && q.source === "contacts" && q.relatedFilters.some((rf) => rf.entity === "opportunity")) {
    applyPipeline = false;
    pipelineIgnored = true;
  }
  const active: ActiveGlobalFilter[] = [];
  for (const g of ctx.globalFilters) {
    const mine = own.get(g.entity);
    if (mine && clauseFields(g.clause).every((f) => mine.has(f))) overridden.push(g.label);
    else active.push(g);
  }
  return { applyPipeline, active, overridden, pipelineIgnored };
}

const PIPELINE_IGNORED = "Ignora el filtro de pipeline: con él, todos los contactos tendrían oportunidad.";

function applyGlobals(source: SourceId, rows: Row[], plan: GlobalPlan, ctx: ResolvedCtx): Row[] {
  let out = rows;
  if (plan.applyPipeline) {
    if (source === "opportunities") {
      out = filterOpportunitiesByPipelines(out as unknown as Opportunity[], ctx.pipelineFilter) as unknown as Row[];
    } else {
      const def = SOURCE_DEFS[source];
      out = filterByContactIds(out, (r) => def.contactIdOf(r), contactIdsInPipelines(ctx.dataset.opportunities, ctx.pipelineFilter));
    }
  }
  if (source === "ads_daily") return out;
  const sourceEntity = entityOf(source);
  for (const g of plan.active) {
    out =
      g.entity === sourceEntity
        ? out.filter((r) => matchesClause(source, r, g.clause, ctx))
        : out.filter((r) => matchesRelated(source, r, { entity: g.entity, quantifier: "any", conditions: [g.clause] }, ctx));
  }
  return out;
}

/**
 * The pipeline and the opportunity-level global filters, evaluated on one
 * opportunity — the candidates a related "opportunity.*" dimension may pick from
 * (Task 6). Same precedence as the row filters.
 */
export function passesGlobalOpportunityFilters(opp: Opportunity, q: QuerySpec, ctx: ResolvedCtx): boolean {
  return passesPlan(opp, globalPlan(q, ctx), ctx);
}

function passesPlan(opp: Opportunity, plan: GlobalPlan, ctx: ResolvedCtx): boolean {
  if (plan.applyPipeline && !ctx.pipelineFilter.includes(opp.pipelineId)) return false;
  const row = opp as unknown as Row;
  return plan.active.filter((g) => g.entity === "opportunity").every((g) => matchesClause("opportunities", row, g.clause, ctx));
}

// ─── Related dimensions (lookup join through the contact) ─────────────────────

export const NO_OPPORTUNITY = "Sin oportunidad";

/**
 * Values of an "opportunity.*" / "contact.*" dimension for a row of another
 * source (spec §6.4). For "opportunity.*" the candidates are ALL the contact's
 * opportunities — never the date-filtered slice — narrowed only by the
 * opportunity-level global filters (pipeline included). "latest" (the default)
 * picks the most recent, so the bars add up to the row count; "each" counts the
 * row once per candidate. A row with no candidate lands in "Sin oportunidad",
 * never silently dropped.
 */
export function relatedResolver(q: QuerySpec, ctx: ResolvedCtx): (row: Row, spec: GroupBySpec) => string[] {
  const plan = globalPlan(q, ctx);
  const contactIdOf = SOURCE_DEFS[q.source].contactIdOf;
  return (row, spec) => {
    const cid = contactIdOf(row);
    if (spec.dimension.startsWith("contact.")) {
      const field = spec.dimension.slice("contact.".length);
      const contact = cid ? ctx.index.contactById.get(cid) : undefined;
      return contact ? dimensionValues("contacts", contact as unknown as Row, field, ctx) : [EMPTY_VALUE];
    }
    const field = spec.dimension.slice("opportunity.".length);
    let cands = cid ? (ctx.index.oppsByContact.get(cid) ?? []) : [];
    if (q.globalFilters === "inherit") cands = cands.filter((o) => passesPlan(o, plan, ctx));
    if (cands.length === 0) return [NO_OPPORTUNITY];
    if (spec.join === "each") return cands.flatMap((o) => dimensionValues("opportunities", o as unknown as Row, field, ctx));
    const latest = cands.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    return dimensionValues("opportunities", latest as unknown as Row, field, ctx);
  };
}

// ─── Field validation ─────────────────────────────────────────────────────────

function assertField(source: SourceId, field: string, ctx: EngineContext): void {
  if (isKnownField(source, field, ctx)) return;
  const cf = /^(?:cf|customField):(.+)$/.exec(field);
  throw new QueryError("unknown_field", cf ? `El campo «${cf[1].trim()}» ya no existe` : `El campo «${field}» no existe en ${source}`);
}

function validateFields(q: QuerySpec, ctx: EngineContext): void {
  for (const g of q.groupBy) {
    if (isRelatedDimension(g.dimension)) {
      const [prefix, ...rest] = g.dimension.split(".");
      const field = rest.join(".");
      const target: SourceId = prefix === "contact" ? "contacts" : "opportunities";
      if (target === q.source || q.source === "ads_daily") {
        throw new QueryError("invalid", `«${g.dimension}» no aplica a ${q.source}: usa el campo propio`);
      }
      assertField(target, field, ctx);
      continue;
    }
    if (g.bucket || isDateField(q.source, g.dimension, ctx)) {
      assertDate(q.source, g.dimension, ctx);
      continue;
    }
    assertField(q.source, g.dimension, ctx);
    for (const f of fallbacksOf(g)) assertOwnOrContactField(q.source, f, ctx);
  }
  for (const c of q.filters) {
    for (const f of c.anyOf) {
      assertField(q.source, f.field, ctx);
      for (const fb of fallbacksOf(f)) assertOwnOrContactField(q.source, fb, ctx);
    }
  }
  for (const rf of q.relatedFilters) {
    const src = ENTITY_SOURCE[rf.entity];
    for (const c of rf.conditions) for (const f of c.anyOf) assertField(src, f.field, ctx);
  }
  assertDate(q.source, q.time.field, ctx);
}

function assertOwnOrContactField(source: SourceId, field: string, ctx: EngineContext): void {
  if (field.startsWith("contact.") && source !== "contacts") assertField("contacts", field.slice("contact.".length), ctx);
  else assertField(source, field, ctx);
}

/** A date the query can bucket or window by. A custom one on a cache without types is pending, not wrong. */
function assertDate(source: SourceId, field: string, ctx: EngineContext): void {
  if (isDateField(source, field, ctx)) return;
  const cf = customFieldName(field.replace(/^contact\./, ""));
  if (cf && !ctx.customFieldTypes) {
    throw new QueryError("pending", `«${cf}» se podrá usar como fecha después de la próxima actualización`);
  }
  throw new QueryError("invalid", `«${field}» no es una fecha de ${source}`);
}

// ─── Buckets ──────────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const COARSER: Partial<Record<Bucket, Bucket>> = { day: "week", week: "month", month: "quarter" };
const BUCKET_NOUN: Partial<Record<Bucket, string>> = { day: "días", week: "semanas", month: "meses", quarter: "trimestres" };
const BUCKET_SINGULAR: Partial<Record<Bucket, string>> = { week: "semana", month: "mes", quarter: "trimestre" };

function bucketKey(d: Date, b: Bucket): string {
  switch (b) {
    case "day":
      return dayKey(d);
    case "week":
      return dayKey(startOfISOWeek(d));
    case "month":
      return format(d, "yyyy-MM");
    case "quarter":
      return `${format(d, "yyyy")}-Q${getQuarter(d)}`;
    case "weekday":
      return String(getISODay(d));
    case "hour":
      return format(d, "HH");
    case "age":
      throw new QueryError("invalid", "Los rangos de días se agrupan con ageBucketKey");
  }
}

function bucketLabel(key: string, b: Bucket): string {
  if (key === EMPTY_VALUE) return key;
  switch (b) {
    case "day":
      return format(parseISO(key), "d MMM yyyy", { locale: es });
    case "week":
      return `sem. ${format(parseISO(key), "d MMM yyyy", { locale: es })}`;
    case "month":
      return format(parseISO(`${key}-01`), "MMM yyyy", { locale: es });
    case "quarter": {
      const [y, qq] = key.split("-Q");
      return `T${qq} ${y}`;
    }
    case "weekday":
      return WEEKDAY_LABELS[Number(key) - 1] ?? key;
    case "hour":
      return `${key}:00`;
    case "age":
      throw new QueryError("invalid", "Los rangos de días se agrupan con ageBucketKey");
  }
}

function bucketsInSpan(from: Date, to: Date, b: Bucket): string[] {
  if (from > to) return [];
  const interval = { start: from, end: to };
  switch (b) {
    case "day":
      return eachDayOfInterval(interval).map(dayKey);
    case "week":
      return eachWeekOfInterval(interval, { weekStartsOn: 1 }).map((d) => dayKey(d));
    case "month":
      return eachMonthOfInterval(interval).map((d) => format(d, "yyyy-MM"));
    case "quarter":
      return eachQuarterOfInterval(interval).map((d) => `${format(d, "yyyy")}-Q${getQuarter(d)}`);
    case "weekday":
      return ["1", "2", "3", "4", "5", "6", "7"];
    case "hour":
      return Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
    case "age":
      throw new QueryError("invalid", "Los rangos de días se agrupan con ageBucketKey");
  }
}

// ─── "Días desde": whole days between a date and today, in ranges ─────────────

/** "a<i>" for the i-th range (edges are inclusive upper bounds), "future" for a date after today, EMPTY_VALUE for none. */
export function ageBucketKey(days: number | null, edges: number[]): string {
  if (days === null) return EMPTY_VALUE;
  if (days < 0) return "future";
  const i = edges.findIndex((e) => days <= e);
  return `a${i === -1 ? edges.length : i}`;
}

const ageKeys = (edges: number[]): string[] => Array.from({ length: edges.length + 1 }, (_, i) => `a${i}`);

function ageBucketLabel(key: string, edges: number[]): string {
  if (key === EMPTY_VALUE) return "Sin fecha";
  if (key === "future") return "Fecha futura";
  const i = Number(key.slice(1));
  if (i === 0) return `0–${edges[0]} días`;
  if (i >= edges.length) return `Más de ${edges[edges.length - 1]} días`;
  return `${edges[i - 1] + 1}–${edges[i]} días`;
}

function observedSpan(rows: Row[], dateOf: (r: Row) => Date | null): { from: Date; to: Date } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const d = dateOf(r);
    if (!d) continue;
    const t = d.getTime();
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return Number.isFinite(min) ? { from: new Date(min), to: new Date(max) } : null;
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

interface DimPlan {
  spec: GroupBySpec;
  bucket: Bucket | null;
  /** Keys every series must show even with no records (gap fill), in order. */
  fill: string[] | null;
  /** bucket "age" only. */
  edges?: number[];
  /** Message dates only: the conversation window, for the "Más de N días o sin mensajes" range. */
  beyondDays?: number;
}

export interface GroupOptions {
  sort: QuerySpec["sort"];
  limit: number | null;
  /** true: the tail after `limit` folds into "Otros". false: it is cut (the assistant's legacy shape). */
  fold: boolean;
  /** Date window for gap filling and bucket sizing (null = observed span). */
  range?: ResolvedDateRange | null;
  /** Extra resolver for related dimensions (Task 6). */
  relatedValues?: (row: Row, spec: GroupBySpec) => string[];
  /** Push "(sin valor)" to the end regardless of its value (default true). The assistant's legacy shape keeps it in value order. */
  emptyLast?: boolean;
}

export interface GroupResult {
  rows: QueryRow[];
  foldedIntoOtros: number;
  seriesFolded: number;
  fanOut: boolean;
  bucketUsed: Bucket | null;
  warnings: string[];
}

function planDims(
  records: Row[],
  source: SourceId,
  groupBy: GroupBySpec[],
  range: ResolvedDateRange | null,
  ctx: ResolvedCtx
): { dims: DimPlan[]; bucketUsed: Bucket | null; warnings: string[] } {
  const warnings: string[] = [];
  let bucketUsed: Bucket | null = null;
  const dims = groupBy.map((spec): DimPlan => {
    const isDate = isDateField(source, spec.dimension, ctx);
    if (!isDate) return { spec, bucket: null, fill: null };
    if (spec.bucket === "age") {
      const edges = edgesOf(spec);
      const conv = ctx.conversations;
      if (isMessageDateField(source, spec.dimension) && conv?.status === "ready") {
        // Ranges that start past the window cannot hold a message; what is older
        // (or never happened) is one honest range: "Más de N días o sin mensajes".
        const lower = (i: number) => (i === 0 ? 0 : edges[i - 1] + 1);
        const fill = [...ageKeys(edges).filter((_, i) => lower(i) <= conv.days), "beyond"];
        return { spec, bucket: "age", fill, edges, beyondDays: conv.days };
      }
      return { spec, bucket: "age", fill: ageKeys(edges), edges };
    }
    let bucket: Bucket = spec.bucket ?? "day";
    const span = range ?? observedSpan(records, (r) => dateValue(source, r, spec.dimension, ctx));
    let fill = span ? bucketsInSpan(span.from, span.to, bucket) : [];
    const requested = bucket;
    while (fill.length > DOC_LIMITS.maxBuckets && COARSER[bucket] && span) {
      bucket = COARSER[bucket]!;
      fill = bucketsInSpan(span.from, span.to, bucket);
    }
    if (bucket !== requested) {
      warnings.push(`Agrupado por ${BUCKET_SINGULAR[bucket]}: había demasiados ${BUCKET_NOUN[requested]} para una gráfica legible.`);
    }
    if (bucketUsed === null) bucketUsed = bucket;
    return { spec, bucket, fill };
  });
  return { dims, bucketUsed, warnings };
}

function valuesFor(row: Row, dim: DimPlan, source: SourceId, ctx: MetricCtx, opts: GroupOptions): string[] {
  if (dim.bucket === "age") {
    if (isMessageDateField(source, dim.spec.dimension) && messageDate(source, row, dim.spec.dimension, ctx) === "beyond") return ["beyond"];
    const d = dateValue(source, row, dim.spec.dimension, ctx);
    return [ageBucketKey(d ? differenceInCalendarDays(ctx.now, d) : null, dim.edges!)];
  }
  if (dim.bucket) {
    const d = dateValue(source, row, dim.spec.dimension, ctx);
    return [d ? bucketKey(d, dim.bucket) : EMPTY_VALUE];
  }
  const fb = fallbacksOf(dim.spec);
  if (fb.length) return fieldValuesWithFallbacks(source, row, [dim.spec.dimension, ...fb], ctx);
  if (isRelatedDimension(dim.spec.dimension)) {
    if (!opts.relatedValues) throw new QueryError("unsupported", `La dimensión «${dim.spec.dimension}» no está disponible aquí`);
    return opts.relatedValues(row, dim.spec);
  }
  return dimensionValues(source, row, dim.spec.dimension, ctx);
}

const capitalize = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t);

// Display text of a group key. Keys stay raw (they are identities: filters,
// drill-downs and the parity check use them); only the label is translated —
// GHL enums to Spanish, source categories to the Marketing chart's names,
// booleans to Sí/No.
function labelFor(key: string, dim: DimPlan, source: SourceId): string {
  if (key === OTROS_KEY) return OTROS;
  if (dim.bucket === "age") return key === "beyond" ? `Más de ${dim.beyondDays} días o sin mensajes` : ageBucketLabel(key, dim.edges!);
  if (dim.bucket && key === EMPTY_VALUE) {
    const f = dim.spec.dimension.replace(/^contact\./, "");
    return `Sin ${customFieldName(f) ?? fieldLabel(f)}`;
  }
  if (dim.bucket) return bucketLabel(key, dim.bucket);
  const related = /^(opportunity|contact)\.(.+)$/.exec(dim.spec.dimension);
  const field = related ? related[2] : dim.spec.dimension;
  const entity: EntityId | null = related ? (related[1] as EntityId) : entityOf(source);
  if (field === "sourceCategory") return catLabel(key);
  if (field === "dePauta" || field === "won" || field === "waitingReply") return key === "true" ? "Sí" : key === "false" ? "No" : key;
  if (field === "lastDirection") return key === "inbound" ? "Entrante" : key === "outbound" ? "Saliente" : key;
  const translated = entity ? ENUM_LABELS_ES[`${entity}.${field}`]?.[key] : undefined;
  return translated ? capitalize(translated) : key;
}

const TERMINAL_FUNNEL = ["Ganado", "Abandonado", "Perdido"];

function naturalRank(dim: DimPlan, source: SourceId, ctx: MetricCtx): ((key: string) => number) | null {
  if (dim.bucket) return null; // chronological keys sort as strings
  const field = dim.spec.dimension.replace(/^opportunity\./, "");
  if (field === "outcome") {
    return (key) => {
      const i = OUTCOME_ORDER.indexOf(key as (typeof OUTCOME_ORDER)[number]);
      return i === -1 ? 500_000 : i;
    };
  }
  if (field === "stage" || field === "funnelState") {
    const order: string[] = [];
    for (const p of ctx.pipelines) for (const s of p.stages) if (!order.includes(s)) order.push(s);
    return (key) => {
      const t = TERMINAL_FUNNEL.indexOf(key);
      if (t !== -1) return 1_000_000 + t;
      const i = order.indexOf(key);
      return i === -1 ? 500_000 : i;
    };
  }
  if (source === "appointments" && dim.spec.dimension === "status") {
    return (key) => {
      const i = APPT_STATUS_ORDER.indexOf(key);
      return i === -1 ? 500_000 : i;
    };
  }
  return null;
}

function dedupe(rows: Row[]): Row[] {
  return [...new Set(rows)];
}

/**
 * Group records by up to two dimensions and measure each group. The second
 * dimension is the series. Metric values of every group — including folded
 * "Otros" and gap-filled buckets — are computed from the group's own records,
 * so ratios are never averaged or summed.
 */
export function groupAndMeasure(
  records: Row[],
  source: SourceId,
  groupBy: GroupBySpec[],
  metrics: MetricId[],
  ctx: MetricCtx,
  opts: GroupOptions
): GroupResult {
  const measure = (rs: Row[]) => metrics.map((m) => METRICS[m].compute(rs, ctx));
  if (groupBy.length === 0) {
    return { rows: [{ key: [], label: [], values: measure(records), records }], foldedIntoOtros: 0, seriesFolded: 0, fanOut: false, bucketUsed: null, warnings: [] };
  }

  const { dims, bucketUsed, warnings } = planDims(records, source, groupBy, opts.range ?? null, ctx);
  const groups = new Map<string, { key: string[]; records: Row[] }>();
  let fanOut = false;
  for (const r of records) {
    const perDim = dims.map((d) => valuesFor(r, d, source, ctx, opts));
    let combos: string[][] = [[]];
    for (const vals of perDim) combos = combos.flatMap((c) => vals.map((v) => [...c, v]));
    if (combos.length > 1) fanOut = true;
    for (const key of combos) {
      const k = key.join(KEY_SEP);
      const g = groups.get(k);
      if (g) g.records.push(r);
      else groups.set(k, { key, records: [r] });
    }
  }

  // Gap fill: every expected bucket of the first dimension exists for every series.
  const fill0 = dims[0].fill;
  if (fill0) {
    const series = dims.length > 1 ? [...new Set([...groups.values()].map((g) => g.key[1]))] : [null];
    for (const k0 of fill0) {
      for (const s of series) {
        const key = s === null ? [k0] : [k0, s];
        const k = key.join(KEY_SEP);
        if (!groups.has(k)) groups.set(k, { key, records: [] });
      }
    }
  }
  // "Días desde" as the second dimension: every range is a column, even empty.
  const fill1 = dims[1]?.bucket === "age" ? dims[1].fill : null;
  if (fill1) {
    for (const k0 of new Set([...groups.values()].map((g) => g.key[0]))) {
      for (const k1 of fill1) {
        const k = [k0, k1].join(KEY_SEP);
        if (!groups.has(k)) groups.set(k, { key: [k0, k1], records: [] });
      }
    }
  }

  // Order of first-dimension keys.
  const byK0 = new Map<string, Row[]>();
  for (const g of groups.values()) byK0.set(g.key[0], [...(byK0.get(g.key[0]) ?? []), ...g.records]);
  const k0Value = new Map<string, number | null>();
  for (const [k0, rs] of byK0) k0Value.set(k0, METRICS[metrics[0]].compute(dedupe(rs), ctx));
  const dir = opts.sort.dir === "asc" ? 1 : -1;
  const rank0 = naturalRank(dims[0], source, ctx);
  const cmpLabel = (a: string, b: string) => labelFor(a, dims[0], source).localeCompare(labelFor(b, dims[0], source), "es");
  const emptyLast = (a: string, b: string) =>
    opts.emptyLast === false ? 0 : (a === EMPTY_VALUE ? 1 : 0) - (b === EMPTY_VALUE ? 1 : 0);
  let k0Order = [...byK0.keys()].sort((a, b) => {
    const e = emptyLast(a, b);
    if (e !== 0) return e;
    // Ranges of days have one order; a value sort would scramble them.
    if (dims[0].bucket === "age") return a.localeCompare(b);
    if (opts.sort.by === "value") {
      const va = k0Value.get(a);
      const vb = k0Value.get(b);
      if (va === null || va === undefined) return vb === null || vb === undefined ? cmpLabel(a, b) : 1;
      if (vb === null || vb === undefined) return -1;
      return va !== vb ? (va - vb) * dir : cmpLabel(a, b);
    }
    if (opts.sort.by === "natural") {
      if (dims[0].bucket) return a.localeCompare(b) * dir;
      if (rank0) return (rank0(a) - rank0(b)) * dir || cmpLabel(a, b);
    }
    return cmpLabel(a, b) * (opts.sort.by === "label" ? dir : 1);
  });

  // Limit: fold the tail into "Otros" (or cut it, for the assistant's shape).
  let foldedIntoOtros = 0;
  const otrosRecords: Row[] = [];
  // A time axis has no "rest": "Otros" at the end of a weekly axis hid the
  // RECENT weeks (sorted oldest first, the limit kept the oldest). On calendar
  // buckets the limit keeps the most recent periods and says so.
  if (opts.fold && opts.limit !== null && dims[0].bucket && dims[0].bucket !== "age" && k0Order.length > opts.limit) {
    const dated = k0Order.filter((k) => k !== EMPTY_VALUE).sort();
    const keep = new Set(dated.slice(-opts.limit));
    k0Order = k0Order.filter((k) => keep.has(k));
    for (const [k, g] of groups) if (!keep.has(g.key[0])) groups.delete(k);
    warnings.push(`Se muestran los últimos ${opts.limit} periodos; los anteriores quedan fuera.`);
  } else if (opts.limit !== null && k0Order.length > opts.limit) {
    const tail = k0Order.slice(opts.limit);
    k0Order = k0Order.slice(0, opts.limit);
    if (opts.fold) {
      foldedIntoOtros = tail.length;
      for (const k0 of tail) otrosRecords.push(...(byK0.get(k0) ?? []));
    }
    const keep = new Set(k0Order);
    for (const [k, g] of groups) if (!keep.has(g.key[0])) groups.delete(k);
  }

  // Series cap: at most maxSeries series, the rest folded into "Otros".
  let seriesFolded = 0;
  let seriesOrder: (string | null)[] = [null];
  if (dims.length > 1) {
    const bySeries = new Map<string, Row[]>();
    for (const g of groups.values()) bySeries.set(g.key[1], [...(bySeries.get(g.key[1]) ?? []), ...g.records]);
    const rank1 = naturalRank(dims[1], source, ctx);
    seriesOrder = [...bySeries.keys()].sort((a, b) => {
      const e = emptyLast(a, b);
      if (e !== 0) return e;
      if (dims[1].bucket) return a.localeCompare(b);
      if (rank1) return rank1(a) - rank1(b) || a.localeCompare(b, "es");
      const va = METRICS[metrics[0]].compute(dedupe(bySeries.get(a)!), ctx) ?? -Infinity;
      const vb = METRICS[metrics[0]].compute(dedupe(bySeries.get(b)!), ctx) ?? -Infinity;
      return vb - va || a.localeCompare(b, "es");
    });
    if (seriesOrder.length > DOC_LIMITS.maxSeries) {
      const keepN = DOC_LIMITS.maxSeries - 1;
      const folded = new Set(seriesOrder.slice(keepN) as string[]);
      seriesFolded = folded.size;
      seriesOrder = [...seriesOrder.slice(0, keepN), OTROS_KEY];
      for (const [k, g] of [...groups]) {
        if (!folded.has(g.key[1])) continue;
        groups.delete(k);
        const key = [g.key[0], OTROS_KEY];
        const kk = key.join(KEY_SEP);
        const existing = groups.get(kk);
        if (existing) existing.records.push(...g.records);
        else groups.set(kk, { key, records: [...g.records] });
      }
    }
  }

  const rows: QueryRow[] = [];
  for (const k0 of k0Order) {
    for (const s of seriesOrder) {
      const key = s === null ? [k0] : [k0, s];
      const g = groups.get(key.join(KEY_SEP));
      if (!g) continue;
      const recs = dedupe(g.records);
      rows.push({ key, label: key.map((k, i) => labelFor(k, dims[i], source)), values: measure(recs), records: recs });
    }
  }
  if (foldedIntoOtros > 0) {
    const recs = dedupe(otrosRecords);
    rows.push({ key: [OTROS_KEY], label: [OTROS], values: measure(recs), records: recs });
  }
  return { rows, foldedIntoOtros, seriesFolded, fanOut, bucketUsed, warnings };
}

/** Row and column totals of a 2-dimension result, each measured over its deduped records. */
function marginsOf(rows: QueryRow[], dims: number, metricIds: MetricId[], mctx: MetricCtx): QueryResult["margins"] {
  if (dims !== 2) return null;
  const first = new Map<string, Row[]>();
  const second = new Map<string, Row[]>();
  const add = (m: Map<string, Row[]>, k: string, rs: Row[]) => {
    const list = m.get(k);
    if (list) list.push(...rs);
    else m.set(k, [...rs]);
  };
  for (const r of rows) {
    add(first, r.key[0], r.records);
    if (r.key.length > 1) add(second, r.key[1], r.records);
  }
  const measure = (m: Map<string, Row[]>) =>
    Object.fromEntries([...m].map(([k, rs]) => [k, metricIds.map((id) => METRICS[id].compute(dedupe(rs), mctx))]));
  return { first: measure(first), second: measure(second) };
}

// ─── runQuery ─────────────────────────────────────────────────────────────────

const APPT_WINDOW_DAYS = 90;
const APPT_WARNING = "Las citas solo cubren 90 días hacia atrás y 90 hacia adelante; fuera de eso no hay datos.";

// Bucket bounds (YYYY-MM-DD) containing a day, for the CPL lead span.
function bucketBounds(day: string, b: Bucket): { from: string; to: string } {
  const d = parseISO(day);
  switch (b) {
    case "week":
      return { from: dayKey(startOfISOWeek(d)), to: dayKey(endOfWeek(d, { weekStartsOn: 1 })) };
    case "month":
      return { from: dayKey(startOfMonth(d)), to: dayKey(endOfMonth(d)) };
    case "quarter":
      return { from: dayKey(startOfQuarter(d)), to: dayKey(endOfQuarter(d)) };
    default:
      return { from: day, to: day };
  }
}

/**
 * Meta spend rows never go through the CRM filters — no own filters, no
 * cross-object filters, no pipeline, no global controls. The window replaces the
 * date filter, and a non-connected account is a state with no numbers at all.
 */
function runAdsQuery(q: QuerySpec, ctx: EngineContext, r: ResolvedCtx, range: ResolvedDateRange | null): QueryResult {
  const ads = adsRowsFor(r, range);
  const metricIds = q.metrics.map((m) => m.metric);
  const baseMeta: QueryMeta = {
    source: q.source,
    recordCount: ads.rows.length,
    range: ads.window,
    bucketUsed: null,
    foldedIntoOtros: 0,
    seriesFolded: 0,
    fanOut: false,
    crmFiltersIgnored: true,
    overriddenGlobals: [],
    warnings: [],
    adsStatus: ads.status,
    adsMessage: ads.message,
  };
  if (ads.status !== "connected" || !ads.window) {
    return { rows: [], totals: metricIds.map(() => null), margins: null, compare: null, meta: baseMeta };
  }
  const window = ads.window;
  const rows = ads.rows as unknown as Row[];
  const windowRange: ResolvedDateRange = { from: startOfDay(parseISO(window.from)), to: endOfDay(parseISO(window.to)) };
  const leadDays = pautaLeadDays(r, window);

  // Size the date bucket first so the lead span uses the same bucket the bars do.
  const planned = planDims(rows, q.source, q.groupBy, windowRange, r);
  const bucket = planned.bucketUsed;
  if (bucket === "weekday" || bucket === "hour") {
    throw new QueryError("invalid", "El gasto de Meta solo se agrupa por día, semana, mes o trimestre");
  }
  const groupBy = q.groupBy.map((g, i) => (i === 0 && bucket ? { ...g, bucket } : g));
  const clip = (s: { from: string; to: string }) => ({
    from: s.from > window.from ? s.from : window.from,
    to: s.to < window.to ? s.to : window.to,
  });
  const groupCtx: MetricCtx = {
    ...r,
    source: q.source,
    range: windowRange,
    adsLeadDays: leadDays,
    adsLeadSpan: (rs) => (rs.length === 0 ? null : bucket ? clip(bucketBounds(String(rs[0].date), bucket)) : window),
  };
  const totalsCtx: MetricCtx = { ...groupCtx, adsLeadSpan: (rs) => (rs.length === 0 ? null : window) };
  const grouped = groupAndMeasure(rows, q.source, groupBy, metricIds, groupCtx, { sort: q.sort, limit: q.limit, fold: true, range: windowRange });

  return {
    rows: grouped.rows,
    totals: metricIds.map((m) => METRICS[m].compute(rows, totalsCtx)),
    margins: null,
    compare: null,
    meta: {
      ...baseMeta,
      bucketUsed: grouped.bucketUsed ?? bucket,
      foldedIntoOtros: grouped.foldedIntoOtros,
      seriesFolded: grouped.seriesFolded,
      warnings: [...planned.warnings, ...grouped.warnings, ...(ads.clipped ? [clippedWarning(window)] : [])],
    },
  };
}

const NO_PREVIOUS = "Sin periodo anterior: el filtro es «Todo el historial»";

/** The earlier window a KPI is compared against. */
function previousRange(range: ResolvedDateRange, mode: "previous_period" | "previous_year"): ResolvedDateRange {
  if (mode === "previous_year") return { from: subYears(range.from, 1), to: subYears(range.to, 1) };
  const days = differenceInCalendarDays(range.to, range.from) + 1;
  return { from: startOfDay(subDays(range.from, days)), to: endOfDay(subDays(range.from, 1)) };
}

/**
 * KPI delta: the same query — same filters, same globals — over the earlier
 * window. Only for ungrouped widgets with a real range; "Todo el historial" has
 * no "before", and saying so beats printing a delta against nothing.
 */
function withCompare(result: QueryResult, q: QuerySpec, ctx: EngineContext): QueryResult {
  if (q.time.compare === "none" || q.groupBy.length > 0) return result;
  const range = resolveWidgetRange(q.time, ctx);
  if (!range) return { ...result, meta: { ...result.meta, warnings: [...result.meta.warnings, NO_PREVIOUS] } };
  const prev = previousRange(range, q.time.compare);
  const prevKeys = { from: dayKey(prev.from), to: dayKey(prev.to) };
  const prevResult = runQuery({ ...q, time: { ...q.time, range: "absolute", ...prevKeys, compare: "none" } }, ctx);
  return { ...result, compare: { totals: prevResult.totals, range: prevKeys } };
}

export function runQuery(q: QuerySpec, ctx: EngineContext): QueryResult {
  const need = conversationDaysNeeded(q);
  if (need !== null) {
    const pending = conversationGate(q, ctx, need);
    if (pending) return pending;
  }
  const res = seriesOf(q).length > 0 || q.ratio ? runMultiQuery(q, ctx) : withCompare(runQueryOnce(q, ctx), q, ctx);
  return need !== null ? withConversationMeta(res, q, ctx) : res;
}

// ─── Conversations (spec 2026-11-02 §3.8) ─────────────────────────────────────

const LOAD_TIME_NOTICE = "Recomendamos limitar el periodo a 60 días o menos para reducir el tiempo de carga.";

/**
 * Days of conversations this query needs loaded, or null when it reads none:
 * the conversations source, or a contact's message date anywhere (axis,
 * filters, fallbacks, the period, a related contact condition, any series).
 */
export function conversationDaysNeeded(q: QuerySpec): number | null {
  const axis = q.groupBy[0]?.dimension;
  const parts = [
    { source: q.source, filters: q.filters, related: q.relatedFilters, fields: [...q.groupBy.flatMap((g) => [g.dimension, ...fallbacksOf(g)]), q.time.field] },
    ...seriesOf(q).map((x) => ({ source: x.source, filters: x.filters, related: x.relatedFilters, fields: [x.dateField, x.dimension ?? axis ?? ""] })),
  ];
  const uses = parts.some(
    (p) =>
      p.source === "conversations" ||
      p.fields.some((f) => isMessageDateField(p.source, f)) ||
      p.filters.some((c) => c.anyOf.some((f) => [f.field, ...fallbacksOf(f)].some((x) => isMessageDateField(p.source, x)))) ||
      p.related.some((rf) => rf.entity === "contact" && rf.conditions.some((c) => c.anyOf.some((f) => MESSAGE_DATE_FIELDS.includes(f.field))))
  );
  return uses ? conversationDaysOf(q) : null;
}

/** Until the index covers the card's window, the result is "loading"/"error" — never measured zeros. */
function conversationGate(q: QuerySpec, ctx: EngineContext, need: number): QueryResult | null {
  const state = ctx.conversations;
  if (state?.status === "ready" && state.days >= need) return null;
  const extra = seriesOf(q).length;
  const n = q.ratio ? 1 : extra ? extra + 1 : q.metrics.length;
  return {
    rows: [],
    totals: Array.from({ length: n }, () => null),
    margins: null,
    compare: null,
    meta: {
      source: q.source,
      recordCount: 0,
      range: rangeKeys(resolveWidgetRange(q.time, ctx)),
      bucketUsed: null,
      foldedIntoOtros: 0,
      seriesFolded: 0,
      fanOut: false,
      crmFiltersIgnored: false,
      overriddenGlobals: [],
      warnings: [],
      adsStatus: null,
      adsMessage: null,
      conversations:
        state?.status === "error"
          ? { status: "error", days: need, message: state.message }
          : state?.status === "loading"
            ? { status: "loading", days: need, scanned: state.scanned, threads: state.threads }
            : { status: "loading", days: need },
    },
  };
}

function withConversationMeta(res: QueryResult, q: QuerySpec, ctx: EngineContext): QueryResult {
  const state = ctx.conversations;
  if (state?.status !== "ready") return res;
  const warnings = [...res.meta.warnings];
  if (state.days > DOC_LIMITS.defaultConversationDays) warnings.push(LOAD_TIME_NOTICE);
  if ([q.source, ...seriesOf(q).map((x) => x.source)].includes("conversations")) {
    const range = resolveWidgetRange(q.time, ctx);
    if (!range || range.from < startOfDay(subDays(ctx.now, state.days))) warnings.push(`Mostrando los últimos ${state.days} días de conversaciones.`);
  }
  if (state.threadErrors > 0) {
    warnings.push(`${state.threadErrors} conversaciones no se pudieron abrir: su último mensaje nuestro puede ser más reciente.`);
  }
  if (state.truncated) warnings.push("La carga de conversaciones llegó a su tope de seguridad: faltan las más antiguas.");
  const clauses = [
    ...q.filters,
    ...q.relatedFilters.filter((rf) => rf.entity === "contact").flatMap((rf) => rf.conditions),
    ...seriesOf(q).flatMap((x) => [...x.filters, ...x.relatedFilters.filter((rf) => rf.entity === "contact").flatMap((rf) => rf.conditions)]),
  ];
  const tooFar = clauses.some((c) =>
    c.anyOf.some((f) => f.op === "days_ago_gte" && MESSAGE_DATE_FIELDS.includes(f.field.replace(/^contact\./, "")) && Number(f.values[0]) > state.days)
  );
  if (tooFar) warnings.push(`No se puede medir más de ${state.days} días con ${state.days} días de conversaciones.`);
  return { ...res, meta: { ...res.meta, warnings, conversations: { status: "ready", days: state.days, truncated: state.truncated } } };
}

// ─── Several series and proportions (spec 2026-11-02 §3.1–3.2) ────────────────

const MISMATCHED_UNITS = (kinds: string) => `Las series mezclan unidades (${kinds}); usa dos tarjetas.`;
const COHORT_NOTE = "Cuenta hasta hoy: los periodos recientes siguen madurando.";
const KIND_NOUN: Record<ValueKind, string> = { count: "conteo", amount: "monto", rate: "porcentaje" };
const DEFAULT_CATEGORY_AXIS = 12;

/** Series 0 is the query itself; its label defaults to the source ("Contactos") for a count. */
export function primarySeries(q: QuerySpec): SeriesSpec {
  const m = q.metrics[0];
  return {
    label: m.label ?? (m.metric === "count" ? SOURCE_LABELS[q.source] : capitalize(METRIC_PHRASES[m.metric])),
    source: q.source,
    metric: m.metric,
    filters: q.filters,
    relatedFilters: q.relatedFilters,
    dateField: q.time.field,
    dimension: null,
  };
}

const sameClauses = <T>(base: T[], sub: T[]): boolean => {
  const have = new Set(sub.map((c) => JSON.stringify(c)));
  return base.every((c) => have.has(JSON.stringify(c)));
};

/** "De los X, cuántos…": same records, the numerator only ADDS conditions. Anything else compares two groups. */
export function ratioKind(num: SeriesSpec, den: SeriesSpec): "same_group" | "between_series" {
  return num.source === den.source &&
    num.dateField === den.dateField &&
    sameClauses(den.filters, num.filters) &&
    sameClauses(den.relatedFilters, num.relatedFilters)
    ? "same_group"
    : "between_series";
}

function runMultiQuery(q: QuerySpec, ctx: EngineContext): QueryResult {
  const all = [primarySeries(q), ...seriesOf(q)];
  const axis = q.groupBy[0] ?? null;
  const axisIsDate = !!axis && isDateField(q.source, axis.dimension, ctx);
  const kinds = all.map((s) => METRICS[s.metric].kind as ValueKind);

  if (!q.ratio && new Set(kinds).size > 1) {
    throw new QueryError("invalid", MISMATCHED_UNITS([...new Set(kinds)].map((k) => KIND_NOUN[k]).join(" y ")));
  }

  // One single-series sub-query per series, each on its own date and its own globals.
  const r = resolveCtx(ctx);
  const range = resolveWidgetRange(q.time, ctx);
  const subs = all.map((s, i) => {
    const groupBy: GroupBySpec[] = !axis
      ? []
      : i === 0
        ? [axis]
        : axisIsDate
          ? [{ dimension: s.dateField, bucket: axis.bucket, join: null, edges: axis.edges ?? null }]
          : [{ ...axis, dimension: s.dimension ?? axis.dimension }];
    const sub: QuerySpec = {
      source: s.source,
      metrics: [{ metric: s.metric, label: null }],
      groupBy,
      filters: s.filters,
      relatedFilters: s.relatedFilters,
      time: { ...q.time, field: s.dateField, compare: "none" },
      globalFilters: q.globalFilters,
      sort: { by: "value", dir: "desc" },
      limit: null,
      conversationDays: q.conversationDays ?? null,
    };
    const res = runQueryOnce(sub, ctx);
    const mctx: MetricCtx = { ...r, source: s.source, range };
    const byKey = new Map(res.rows.map((row) => [row.key[0] ?? "", row]));
    return { spec: s, res, mctx, byKey };
  });

  // The axis: chronological for dates (union of every series' buckets), by the
  // primary series' value for categories, cut to the limit with "Otros".
  const labelOf = new Map<string, string>();
  for (const sub of subs) for (const row of sub.res.rows) if (row.key.length) labelOf.set(row.key[0], row.label[0]);
  let axisKeys: string[] = [];
  let folded: string[] = [];
  if (axis) {
    const seen: string[] = [];
    for (const sub of subs) for (const row of sub.res.rows) if (row.key.length && !seen.includes(row.key[0])) seen.push(row.key[0]);
    const emptyLast = (a: string, b: string) => (a === EMPTY_VALUE ? 1 : 0) - (b === EMPTY_VALUE ? 1 : 0);
    if (axisIsDate) {
      axisKeys = seen.sort((a, b) => emptyLast(a, b) || a.localeCompare(b));
    } else {
      axisKeys = seen.filter((k) => k !== OTROS_KEY).sort((a, b) => emptyLast(a, b));
      const cap = q.limit ?? DEFAULT_CATEGORY_AXIS;
      if (axisKeys.length > cap) {
        folded = axisKeys.slice(cap);
        axisKeys = axisKeys.slice(0, cap);
      }
    }
  }

  // Value and records of series i at an axis key (an absent key is an empty group).
  const cell = (i: number, key: string): { value: number | null; records: Row[] } => {
    const sub = subs[i];
    if (key === OTROS_KEY) {
      const recs = dedupe(folded.flatMap((k) => sub.byKey.get(k)?.records ?? []));
      return { value: METRICS[sub.spec.metric].compute(recs, sub.mctx), records: recs };
    }
    const row = sub.byKey.get(key);
    return row ? { value: row.values[0], records: row.records } : { value: METRICS[sub.spec.metric].compute([], sub.mctx), records: [] };
  };
  const keys = axis ? [...axisKeys, ...(folded.length ? [OTROS_KEY] : [])] : [""];
  const axisLabel = (k: string) => (k === OTROS_KEY ? OTROS : labelOf.get(k) ?? k);
  const totals = subs.map((sub) => sub.res.totals[0]);

  const warnings = [...new Set(subs.flatMap((sub) => sub.res.meta.warnings))];
  const base = subs[0].res.meta;
  const meta: QueryMeta = {
    ...base,
    recordCount: subs.reduce((n, sub) => n + sub.res.meta.recordCount, 0),
    foldedIntoOtros: folded.length,
    warnings,
    seriesLabels: all.map((s) => s.label),
    ...(subs.some((sub) => sub.res.meta.pipelineIgnored) ? { pipelineIgnored: true as const } : {}),
  };

  if (q.ratio) {
    const n = q.ratio.numerator;
    const d = q.ratio.denominator;
    if (n === d || !all[n] || !all[d]) throw new QueryError("invalid", "La proporción apunta a series que no existen");
    const [kn, kd] = [kinds[n], kinds[d]];
    const valueKind: ValueKind | null = kn === kd ? "rate" : kn === "amount" && kd === "count" ? "amount" : null;
    if (!valueKind) throw new QueryError("invalid", "Esa proporción no tiene una unidad clara; usa dos tarjetas.");
    const div = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : a / b);
    const kind = ratioKind(all[n], all[d]);
    const rows: QueryRow[] = axis
      ? keys.map((k) => {
          const num = cell(n, k);
          const den = cell(d, k);
          return { key: [k], label: [axisLabel(k)], values: [div(num.value, den.value)], records: num.records, parts: [num.value, den.value] };
        })
      : [{ key: [], label: [], values: [div(totals[n], totals[d])], records: subs[n].res.rows.flatMap((row) => row.records), parts: [totals[n], totals[d]] }];
    const ratioWarnings =
      kind === "between_series"
        ? [`«${all[n].label}» y «${all[d].label}» no son los mismos registros: el cociente compara ritmos, no es una conversión.`]
        : axisIsDate || range
          ? [COHORT_NOTE]
          : [];
    return {
      rows,
      totals: [div(totals[n], totals[d])],
      margins: null,
      compare: null,
      meta: {
        ...meta,
        warnings: [...warnings, ...ratioWarnings],
        valueKind,
        ratio: { kind, numeratorLabel: all[n].label, denominatorLabel: all[d].label, parts: [totals[n], totals[d]] },
      },
    };
  }

  const rows: QueryRow[] = axis
    ? keys.flatMap((k) =>
        subs.map((_, i) => {
          const c = cell(i, k);
          return { key: [k, `s${i}`], label: [axisLabel(k), all[i].label], values: [c.value], records: c.records };
        })
      )
    : subs.map((sub, i) => ({ key: [`s${i}`], label: [all[i].label], values: [totals[i]], records: sub.res.rows.flatMap((row) => row.records) }));
  return { rows, totals, margins: null, compare: null, meta: { ...meta, valueKind: kinds[0] } };
}

function runQueryOnce(q: QuerySpec, ctx: EngineContext): QueryResult {
  validateFields(q, ctx);
  const r = resolveCtx(ctx);
  const def = SOURCE_DEFS[q.source];
  const range = resolveWidgetRange(q.time, ctx);
  if (q.source === "ads_daily") return runAdsQuery(q, ctx, r, range);
  const warnings: string[] = [];

  let rows = def.rows(ctx);
  if (q.filters.length) rows = rows.filter((row) => matchesAll(q.source, row, q.filters, r));
  for (const rf of q.relatedFilters) rows = rows.filter((row) => matchesRelated(q.source, row, rf, r));
  const ranged = applyRange(q.source, q.time.field, rows, range, r);
  rows = ranged.rows;
  const plan = globalPlan(q, ctx);
  rows = applyGlobals(q.source, rows, plan, r);
  // Only a CUSTOM date says what it left out: a missing native secondary date
  // (an open opportunity's closedAt) is the normal state, not a gap to report.
  const undated = customFieldName(q.time.field) && ranged.undated.length ? applyGlobals(q.source, ranged.undated, plan, r) : [];
  if (undated.length) warnings.push(undatedWarning(q.source, q.time.field, undated.length));
  if (plan.pipelineIgnored) warnings.push(PIPELINE_IGNORED);

  if (q.source === "appointments") {
    const earliest = startOfDay(subDays(ctx.now, APPT_WINDOW_DAYS)).getTime();
    const latest = endOfDay(addDays(ctx.now, APPT_WINDOW_DAYS)).getTime();
    if (!range || range.from.getTime() < earliest || range.to.getTime() > latest) warnings.push(APPT_WARNING);
  }

  const mctx: MetricCtx = { ...r, source: q.source, range };
  const metricIds = q.metrics.map((m) => m.metric);
  const grouped = groupAndMeasure(rows, q.source, q.groupBy, metricIds, mctx, {
    sort: q.sort,
    limit: q.limit,
    fold: true,
    range,
    relatedValues: relatedResolver(q, r),
  });

  return {
    rows: grouped.rows,
    totals: metricIds.map((m) => METRICS[m].compute(rows, mctx)),
    margins: marginsOf(grouped.rows, q.groupBy.length, metricIds, mctx),
    compare: null,
    meta: {
      ...(undated.length ? { undated: { field: q.time.field, records: undated } } : {}),
      ...(plan.pipelineIgnored ? { pipelineIgnored: true as const } : {}),
      source: q.source,
      recordCount: rows.length,
      range: rangeKeys(range),
      bucketUsed: grouped.bucketUsed,
      foldedIntoOtros: grouped.foldedIntoOtros,
      seriesFolded: grouped.seriesFolded,
      fanOut: grouped.fanOut,
      crmFiltersIgnored: false,
      overriddenGlobals: plan.overridden,
      warnings: [...grouped.warnings, ...warnings],
      adsStatus: null,
      adsMessage: null,
    },
  };
}
