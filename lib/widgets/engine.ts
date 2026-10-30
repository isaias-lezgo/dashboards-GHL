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
} from "date-fns";
import { es } from "date-fns/locale";
import type { AdsStatus, Opportunity } from "@/lib/types";
import type { ResolvedDateRange } from "@/lib/date-range";
import { contactIdsInPipelines, filterByContactIds, filterOpportunitiesByPipelines } from "@/lib/pipeline-filter";
import { APPT_STATUS_ORDER } from "@/lib/appointment-status";
import { DOC_LIMITS, SOURCE_ENTITY, type Bucket, type EntityId, type GroupBySpec, type MetricId, type QuerySpec, type SourceId, type TimeSpec } from "./spec";
import { METRICS, type MetricCtx } from "./metrics";
import {
  ENTITY_SOURCE,
  EMPTY_VALUE,
  QueryError,
  SOURCE_DEFS,
  clauseFields,
  dimensionValues,
  isDateField,
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
}

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
}

export interface QueryResult {
  rows: QueryRow[];
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

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function applyRange(source: SourceId, field: string, rows: Row[], range: ResolvedDateRange | null): Row[] {
  if (!range) return rows;
  // Undated rows stay when the field is the source's own date (parity with
  // filterByDateRange); a secondary date (closedAt, dueDate…) that is missing
  // means the event never happened, so the row is out (parity with closedAfter).
  const keepUndated = SOURCE_DEFS[source].primaryDate === field;
  const from = range.from.getTime();
  const to = range.to.getTime();
  return rows.filter((r) => {
    const d = toDate(r[field]);
    if (!d) return keepUndated;
    const t = d.getTime();
    return t >= from && t <= to;
  });
}

// ─── Global filters ───────────────────────────────────────────────────────────

interface GlobalPlan {
  applyPipeline: boolean;
  active: ActiveGlobalFilter[];
  overridden: string[];
}

/** Which global filters apply to this widget, honoring "the widget's own filter on the same field wins". */
function globalPlan(q: QuerySpec, ctx: EngineContext): GlobalPlan {
  if (q.source === "ads_daily" || q.globalFilters === "ignore") return { applyPipeline: false, active: [], overridden: [] };
  const own = new Map<EntityId, Set<string>>();
  const add = (entity: EntityId, fields: string[]) => {
    const set = own.get(entity) ?? new Set<string>();
    for (const f of fields) set.add(f);
    own.set(entity, set);
  };
  const sourceEntity = SOURCE_ENTITY[q.source];
  for (const c of q.filters) add(sourceEntity, clauseFields(c));
  for (const rf of q.relatedFilters) for (const c of rf.conditions) add(rf.entity, clauseFields(c));

  const overridden: string[] = [];
  let applyPipeline = ctx.pipelineFilter.length > 0;
  const oppFields = own.get("opportunity");
  if (applyPipeline && oppFields && (oppFields.has("pipelineId") || oppFields.has("pipelineName"))) {
    applyPipeline = false;
    overridden.push("pipeline");
  }
  const active: ActiveGlobalFilter[] = [];
  for (const g of ctx.globalFilters) {
    const mine = own.get(g.entity);
    if (mine && clauseFields(g.clause).every((f) => mine.has(f))) overridden.push(g.label);
    else active.push(g);
  }
  return { applyPipeline, active, overridden };
}

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
  const sourceEntity = SOURCE_ENTITY[source];
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
    if (g.bucket || isDateField(q.source, g.dimension)) {
      if (!isDateField(q.source, g.dimension)) throw new QueryError("invalid", `«${g.dimension}» no es una fecha de ${q.source}`);
      continue;
    }
    assertField(q.source, g.dimension, ctx);
  }
  for (const c of q.filters) for (const f of c.anyOf) assertField(q.source, f.field, ctx);
  for (const rf of q.relatedFilters) {
    const src = ENTITY_SOURCE[rf.entity];
    for (const c of rf.conditions) for (const f of c.anyOf) assertField(src, f.field, ctx);
  }
  if (!SOURCE_DEFS[q.source].dateFields.includes(q.time.field)) {
    throw new QueryError("invalid", `«${q.time.field}» no es una fecha de ${q.source}`);
  }
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
  }
}

function observedSpan(rows: Row[], field: string): { from: Date; to: Date } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const d = toDate(r[field]);
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
}

export interface GroupResult {
  rows: QueryRow[];
  foldedIntoOtros: number;
  seriesFolded: number;
  fanOut: boolean;
  bucketUsed: Bucket | null;
  warnings: string[];
}

function planDims(records: Row[], source: SourceId, groupBy: GroupBySpec[], range: ResolvedDateRange | null): { dims: DimPlan[]; bucketUsed: Bucket | null; warnings: string[] } {
  const warnings: string[] = [];
  let bucketUsed: Bucket | null = null;
  const dims = groupBy.map((spec): DimPlan => {
    const isDate = !isRelatedDimension(spec.dimension) && isDateField(source, spec.dimension);
    if (!isDate) return { spec, bucket: null, fill: null };
    let bucket: Bucket = spec.bucket ?? "day";
    const span = range ?? observedSpan(records, spec.dimension);
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
  if (dim.bucket) {
    const d = toDate(row[dim.spec.dimension]);
    return [d ? bucketKey(d, dim.bucket) : EMPTY_VALUE];
  }
  if (isRelatedDimension(dim.spec.dimension)) {
    if (!opts.relatedValues) throw new QueryError("unsupported", `La dimensión «${dim.spec.dimension}» no está disponible aquí`);
    return opts.relatedValues(row, dim.spec);
  }
  return dimensionValues(source, row, dim.spec.dimension, ctx);
}

function labelFor(key: string, dim: DimPlan): string {
  if (key === OTROS_KEY) return OTROS;
  return dim.bucket ? bucketLabel(key, dim.bucket) : key;
}

const TERMINAL_FUNNEL = ["Ganado", "Abandonado", "Perdido"];

function naturalRank(dim: DimPlan, source: SourceId, ctx: MetricCtx): ((key: string) => number) | null {
  if (dim.bucket) return null; // chronological keys sort as strings
  const field = dim.spec.dimension.replace(/^opportunity\./, "");
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

  const { dims, bucketUsed, warnings } = planDims(records, source, groupBy, opts.range ?? null);
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

  // Order of first-dimension keys.
  const byK0 = new Map<string, Row[]>();
  for (const g of groups.values()) byK0.set(g.key[0], [...(byK0.get(g.key[0]) ?? []), ...g.records]);
  const k0Value = new Map<string, number | null>();
  for (const [k0, rs] of byK0) k0Value.set(k0, METRICS[metrics[0]].compute(dedupe(rs), ctx));
  const dir = opts.sort.dir === "asc" ? 1 : -1;
  const rank0 = naturalRank(dims[0], source, ctx);
  const cmpLabel = (a: string, b: string) => labelFor(a, dims[0]).localeCompare(labelFor(b, dims[0]), "es");
  const emptyLast = (a: string, b: string) => (a === EMPTY_VALUE ? 1 : 0) - (b === EMPTY_VALUE ? 1 : 0);
  let k0Order = [...byK0.keys()].sort((a, b) => {
    const e = emptyLast(a, b);
    if (e !== 0) return e;
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
  if (opts.limit !== null && k0Order.length > opts.limit) {
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
      rows.push({ key, label: key.map((k, i) => labelFor(k, dims[i])), values: measure(recs), records: recs });
    }
  }
  if (foldedIntoOtros > 0) {
    const recs = dedupe(otrosRecords);
    rows.push({ key: [OTROS_KEY], label: [OTROS], values: measure(recs), records: recs });
  }
  return { rows, foldedIntoOtros, seriesFolded, fanOut, bucketUsed, warnings };
}

// ─── runQuery ─────────────────────────────────────────────────────────────────

const APPT_WINDOW_DAYS = 90;
const APPT_WARNING = "Las citas solo cubren 90 días hacia atrás y 90 hacia adelante; fuera de eso no hay datos.";

export function runQuery(q: QuerySpec, ctx: EngineContext): QueryResult {
  validateFields(q, ctx);
  const r = resolveCtx(ctx);
  const def = SOURCE_DEFS[q.source];
  const range = resolveWidgetRange(q.time, ctx);
  const warnings: string[] = [];

  let rows = def.rows(ctx);
  if (q.filters.length) rows = rows.filter((row) => matchesAll(q.source, row, q.filters, r));
  for (const rf of q.relatedFilters) rows = rows.filter((row) => matchesRelated(q.source, row, rf, r));
  rows = applyRange(q.source, q.time.field, rows, range);
  const plan = globalPlan(q, ctx);
  rows = applyGlobals(q.source, rows, plan, r);

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
    compare: null,
    meta: {
      source: q.source,
      recordCount: rows.length,
      range: rangeKeys(range),
      bucketUsed: grouped.bucketUsed,
      foldedIntoOtros: grouped.foldedIntoOtros,
      seriesFolded: grouped.seriesFolded,
      fanOut: grouped.fanOut,
      crmFiltersIgnored: q.source === "ads_daily",
      overriddenGlobals: plan.overridden,
      warnings: [...grouped.warnings, ...warnings],
      adsStatus: null,
      adsMessage: null,
    },
  };
}
