// The semantic layer of the AI panel: what each source's rows are, how a field
// is read off a row, which derived fields exist, and how filters — own,
// cross-object and global — are evaluated. Pure and client-safe.
//
// Every domain rule here is IMPORTED, never re-inlined: "won" is isWonOpp,
// "de pauta" is isDePauta, a source category is sourceCategory. The panel must
// give the same number as the hand-built dashboards for the same question
// (spec §3, goal 6), and two implementations of one rule drift.
import type { AdsReport, Opportunity, Pipeline } from "@/lib/types";
import type { ChatDataset } from "@/lib/ai-tools";
import type { ResolvedDateRange } from "@/lib/date-range";
import type { PipelineFilter } from "@/lib/pipeline-filter";
import { getChatIndex, type ChatIndex } from "@/lib/ai-index";
import { campaignTitle, isDePauta, rankPautasByContact, resolveCampaignName } from "@/lib/pauta";
import { isWonOpp } from "@/lib/opportunity-status";
import { platformLabel, sourceCategory } from "@/lib/source-platform";
import { cfValues, customFieldName, type CustomFieldsResolved } from "@/lib/custom-fields";
import type { EntityId, FilterClause, FilterSpec, RelatedFilterSpec, SourceId } from "./spec";

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * One active global filter control, already reduced to a clause. A `field`
 * control with values becomes `{ anyOf: [{ field, op: "in", values }] }`; a
 * `condition` control that is on contributes its own clause. Controls on
 * "todos" or switched off are not passed at all.
 */
export interface ActiveGlobalFilter {
  entity: EntityId;
  label: string;
  clause: FilterClause;
}

export interface EngineContext {
  dataset: ChatDataset;
  pipelines: Pipeline[];
  ads: AdsReport | undefined;
  /** The panel's date filter. null = "Todo el historial". */
  dateRange: ResolvedDateRange | null;
  /** The panel's pipeline filter. [] = todos. */
  pipelineFilter: PipelineFilter;
  globalFilters: ActiveGlobalFilter[];
  now: Date;
}

interface DatasetDerived {
  index: ChatIndex;
  /** Contacts with at least one Pauta record over the FULL history (isDePauta's union). */
  pautaContactsAll: Set<string>;
  pautaRank: Map<string, number>;
  relatedCache: Map<string, Set<string>>;
}

export interface ResolvedCtx extends EngineContext, Omit<DatasetDerived, "relatedCache"> {
  relatedCache: Map<string, Set<string>>;
}

// Keyed by the contacts array and validated against the other arrays, the same
// scheme as getChatIndex: a refresh replaces the arrays, so a stale entry can
// never be served for new data.
const derivedCache = new WeakMap<object, { dataset: ChatDataset; derived: DatasetDerived }>();

function sameDataset(a: ChatDataset, b: ChatDataset): boolean {
  return (
    a.contacts === b.contacts &&
    a.opportunities === b.opportunities &&
    a.pautas === b.pautas &&
    a.appointments === b.appointments &&
    a.tasks === b.tasks
  );
}

export function resolveCtx(ctx: EngineContext): ResolvedCtx {
  const hit = derivedCache.get(ctx.dataset.contacts);
  let derived: DatasetDerived;
  if (hit && sameDataset(hit.dataset, ctx.dataset)) {
    derived = hit.derived;
  } else {
    const pautaContactsAll = new Set<string>();
    for (const p of ctx.dataset.pautas) if (p.contactId) pautaContactsAll.add(p.contactId);
    derived = {
      index: getChatIndex(ctx.dataset),
      pautaContactsAll,
      pautaRank: rankPautasByContact(ctx.dataset.pautas),
      relatedCache: new Map(),
    };
    derivedCache.set(ctx.dataset.contacts, { dataset: ctx.dataset, derived });
  }
  return { ...ctx, ...derived };
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class QueryError extends Error {
  constructor(
    public code: "unknown_field" | "unsupported" | "invalid",
    message: string
  ) {
    super(message);
    this.name = "QueryError";
  }
}

// ─── Sources ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface SourceDef {
  dateFields: string[];
  primaryDate: string;
  contactIdOf(row: Row): string | undefined;
  rows(ctx: EngineContext): Row[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const asRows = (a: readonly unknown[]): Row[] => a as Row[];

export const SOURCE_DEFS: Record<SourceId, SourceDef> = {
  contacts: {
    dateFields: ["createdAt"],
    primaryDate: "createdAt",
    contactIdOf: (r) => str(r.id),
    rows: (ctx) => asRows(ctx.dataset.contacts),
  },
  opportunities: {
    dateFields: ["createdAt", "closedAt", "updatedAt"],
    primaryDate: "createdAt",
    contactIdOf: (r) => str(r.contactId),
    rows: (ctx) => asRows(ctx.dataset.opportunities),
  },
  appointments: {
    dateFields: ["startTime"],
    primaryDate: "startTime",
    contactIdOf: (r) => str(r.contactId),
    rows: (ctx) => asRows(ctx.dataset.appointments),
  },
  tasks: {
    dateFields: ["dueDate", "createdAt"],
    primaryDate: "dueDate",
    contactIdOf: (r) => str(r.contactId),
    rows: (ctx) => asRows(ctx.dataset.tasks),
  },
  pautas: {
    dateFields: ["createdAt"],
    primaryDate: "createdAt",
    contactIdOf: (r) => str(r.contactId),
    rows: (ctx) => asRows(ctx.dataset.pautas),
  },
  ads_daily: {
    dateFields: ["date"],
    primaryDate: "date",
    contactIdOf: () => undefined,
    rows: (ctx) => asRows(ctx.ads?.daily ?? []),
  },
  // Filled in by the conversations task; until then the source has no rows.
  conversations: {
    dateFields: ["lastMessageAt"],
    primaryDate: "lastMessageAt",
    contactIdOf: (r) => str(r.contactId),
    rows: () => [],
  },
};

export const ENTITY_SOURCE: Record<EntityId, Exclude<SourceId, "ads_daily">> = {
  contact: "contacts",
  opportunity: "opportunities",
  appointment: "appointments",
  task: "tasks",
  pauta: "pautas",
};

// The same fields list_fields and aggregate.groupBy expose today (lib/ai-tools.ts).
export const NATIVE_FIELDS: Record<SourceId, string[]> = {
  contacts: [
    "id", "name", "email", "phone", "companyName", "city", "state", "country", "timezone",
    "tags", "source", "campaign", "adType", "adId", "attributionMedium", "attributionUrl",
    "assignedTo", "dnd", "type", "createdAt", "dateAdded", "dateUpdated", "lastActivity",
  ],
  opportunities: [
    "id", "name", "contactId", "pipelineId", "pipelineName", "stage", "status", "value",
    "monetaryValue", "currency", "probability", "source", "campaign", "adType", "adId",
    "attributionMedium", "attributionUrl", "assignedTo", "tags", "priority", "lostReason",
    "archived", "origin", "createdAt", "closedAt", "updatedAt", "lastActivity",
  ],
  appointments: ["id", "contactId", "assignedTo", "title", "status", "startTime", "endTime"],
  tasks: ["id", "title", "status", "assignedTo", "assignedToName", "contactId", "opportunityId", "dueDate", "createdAt"],
  pautas: ["id", "tipo", "nombrePauta", "contactId", "createdAt"],
  ads_daily: ["date"],
  conversations: [],
};

export const DERIVED_FIELDS: Partial<Record<SourceId, string[]>> = {
  opportunities: ["dePauta", "campaignResolved", "won", "funnelState", "sourceCategory", "platform"],
};

const CF_SOURCES: SourceId[] = ["contacts", "opportunities"];

/** Filterable fields per object, with the Spanish label the UI and ScopePill use. */
export const ENTITY_FIELDS: Record<EntityId, { field: string; label: string }[]> = {
  opportunity: [
    { field: "pipelineName", label: "Pipeline" },
    { field: "stage", label: "Etapa" },
    { field: "status", label: "Estado" },
    { field: "won", label: "Ganada" },
    { field: "assignedTo", label: "Asesor" },
    { field: "source", label: "Fuente" },
    { field: "platform", label: "Plataforma" },
    { field: "dePauta", label: "De pauta" },
    { field: "lostReason", label: "Motivo de pérdida" },
  ],
  contact: [
    { field: "source", label: "Fuente" },
    { field: "attributionMedium", label: "Plataforma" },
    { field: "tags", label: "Tags" },
    { field: "assignedTo", label: "Asesor" },
    { field: "city", label: "Ciudad" },
  ],
  appointment: [
    { field: "status", label: "Estado" },
    { field: "assignedTo", label: "Asesor" },
  ],
  task: [
    { field: "status", label: "Estado" },
    { field: "assignedToName", label: "Asesor" },
  ],
  pauta: [
    { field: "tipo", label: "Tipo" },
    { field: "nombrePauta", label: "Campaña" },
  ],
};

export function isRelatedDimension(d: string): boolean {
  return d.startsWith("contact.") || d.startsWith("opportunity.");
}

export function isDateField(source: SourceId, field: string): boolean {
  return SOURCE_DEFS[source].dateFields.includes(field) || field === "lastActivity" || field === "dateUpdated";
}

export function knownCustomFields(source: SourceId, ctx: EngineContext): Set<string> {
  const names = new Set<string>();
  if (!CF_SOURCES.includes(source)) return names;
  for (const r of SOURCE_DEFS[source].rows(ctx)) {
    const resolved = r.customFieldsResolved as CustomFieldsResolved;
    if (resolved) for (const k of Object.keys(resolved)) names.add(k);
  }
  return names;
}

/** Is `field` something this source can read? Related dimensions are checked by the engine. */
export function isKnownField(source: SourceId, field: string, ctx: EngineContext): boolean {
  const cf = customFieldName(field);
  if (cf) {
    const target = cf.toLowerCase();
    for (const k of knownCustomFields(source, ctx)) if (k.toLowerCase() === target) return true;
    return false;
  }
  return NATIVE_FIELDS[source].includes(field) || (DERIVED_FIELDS[source]?.includes(field) ?? false);
}

// ─── Reading fields ───────────────────────────────────────────────────────────

export const EMPTY_VALUE = "(sin valor)";
export const EMPTY_TAG = "(sin tag)";

/**
 * Where an opportunity stands right now — the rule of "Estado actual del embudo
 * por etapa" (components/dashboard/sales-dashboard.tsx). There is no stage
 * history in the sync, so this is a snapshot, never a conversion step.
 */
export function funnelState(opp: Opportunity): string {
  if (isWonOpp(opp)) return "Ganado";
  if (opp.status === "abandoned") return "Abandonado";
  if (opp.status === "lost") return "Perdido";
  return opp.stage || EMPTY_VALUE;
}

function derivedValue(field: string, opp: Opportunity, ctx: ResolvedCtx): string | undefined {
  switch (field) {
    case "dePauta":
      return isDePauta(opp, ctx.pautaContactsAll) ? "true" : "false";
    case "won":
      return isWonOpp(opp) ? "true" : "false";
    case "campaignResolved":
      return campaignTitle(resolveCampaignName(opp, ctx.index.pautaNameByContact)) || EMPTY_VALUE;
    case "funnelState":
      return funnelState(opp);
    case "sourceCategory":
      return sourceCategory(opp);
    case "platform":
      return platformLabel(opp);
    default:
      return undefined;
  }
}

function scalar(v: unknown): string {
  if (v === null || v === undefined || v === "") return EMPTY_VALUE;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  return s.includes(" - http") ? (campaignTitle(s) ?? s) : s;
}

/**
 * The value(s) a row holds for a field of its own source. Always at least one:
 * empty fields read as "(sin valor)" (tags: "(sin tag)"), so nothing drops out of
 * a grouping silently. Multi-valued fields (tags, multi-option custom fields)
 * fan out, exactly like aggregate's groupBy does today.
 */
export function dimensionValues(source: SourceId, row: Row, field: string, ctx: ResolvedCtx): string[] {
  if (isRelatedDimension(field)) {
    throw new QueryError("unsupported", `La dimensión relacionada «${field}» la resuelve el motor`);
  }
  const cf = customFieldName(field);
  if (cf) {
    const vals = cfValues(row.customFieldsResolved as CustomFieldsResolved, cf);
    return vals.length ? vals : [EMPTY_VALUE];
  }
  if (source === "opportunities") {
    const d = derivedValue(field, row as unknown as Opportunity, ctx);
    if (d !== undefined) return [d];
  }
  const raw = row[field];
  if (Array.isArray(raw)) {
    const vals = raw.filter((x) => x !== null && x !== undefined && x !== "").map((x) => String(x));
    if (vals.length) return vals;
    return [field === "tags" ? EMPTY_TAG : EMPTY_VALUE];
  }
  return [scalar(raw)];
}

// ─── Filters ──────────────────────────────────────────────────────────────────

const lc = (s: string): string => s.trim().toLowerCase();
const isEmptyValue = (v: string): boolean => v === EMPTY_VALUE || v === EMPTY_TAG;

function asComparable(v: string, dateLike: boolean): number {
  if (dateLike) return Date.parse(v);
  return Number(v);
}

/** One condition against a row of `source`. Case-insensitive; `in`/`eq` = any of values. */
export function matchesFilter(source: SourceId, row: Row, f: FilterSpec, ctx: ResolvedCtx): boolean {
  const have = dimensionValues(source, row, f.field, ctx);
  const haveLc = have.map(lc);
  const wanted = f.values.map(lc);
  switch (f.op) {
    case "eq":
    case "in":
      return wanted.some((w) => haveLc.includes(w));
    case "neq":
    case "not_in":
      return !wanted.some((w) => haveLc.includes(w));
    case "contains":
      return wanted.some((w) => haveLc.some((h) => !isEmptyValue(h) && h.includes(w)));
    case "is_empty":
      return have.every(isEmptyValue);
    case "is_not_empty":
      return !have.every(isEmptyValue);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (have.every(isEmptyValue) || f.values.length === 0) return false;
      const dateLike = isDateField(source, f.field);
      const a = asComparable(have[0], dateLike);
      const b = asComparable(f.values[0], dateLike);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (f.op === "gt") return a > b;
      if (f.op === "gte") return a >= b;
      if (f.op === "lt") return a < b;
      return a <= b;
    }
    case "days_ago_gte":
    case "days_ago_lte":
      throw new QueryError("unsupported", "Los filtros de «hace N días» todavía no están disponibles");
  }
}

export function matchesClause(source: SourceId, row: Row, c: FilterClause, ctx: ResolvedCtx): boolean {
  return c.anyOf.some((f) => matchesFilter(source, row, f, ctx));
}

export function matchesAll(source: SourceId, row: Row, clauses: FilterClause[], ctx: ResolvedCtx): boolean {
  return clauses.every((c) => matchesClause(source, row, c, ctx));
}

export function clauseFields(c: FilterClause): string[] {
  return [...new Set(c.anyOf.map((f) => f.field))];
}

/** Distinct values of an object's field over ALL its records, most frequent first. */
export function listFieldValues(entity: EntityId, field: string, ctx: ResolvedCtx): { value: string; count: number }[] {
  const source = ENTITY_SOURCE[entity];
  const counts = new Map<string, number>();
  for (const r of SOURCE_DEFS[source].rows(ctx)) {
    for (const v of dimensionValues(source, r, field, ctx)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * Contacts with at least one `rf.entity` record that satisfies ALL clauses ON THE
 * SAME RECORD, over the full dataset (never the date-filtered slice — the same
 * invariant contactIdsInPipelines carries). Evaluating each clause on its own
 * would let "lost in pipeline Ventas" match a contact with a lost opportunity in
 * another pipeline and an open one in Ventas.
 */
export function contactsMatchingRelated(rf: RelatedFilterSpec, ctx: ResolvedCtx): Set<string> {
  const key = JSON.stringify({ e: rf.entity, c: rf.conditions });
  const hit = ctx.relatedCache.get(key);
  if (hit) return hit;
  const source = ENTITY_SOURCE[rf.entity];
  const def = SOURCE_DEFS[source];
  const out = new Set<string>();
  for (const r of def.rows(ctx)) {
    const cid = def.contactIdOf(r);
    if (cid && matchesAll(source, r, rf.conditions, ctx)) out.add(cid);
  }
  ctx.relatedCache.set(key, out);
  return out;
}

/** A row passes when its contact is in (any) / out of (none) the related set. No contact → false. */
export function matchesRelated(source: SourceId, row: Row, rf: RelatedFilterSpec, ctx: ResolvedCtx): boolean {
  const cid = SOURCE_DEFS[source].contactIdOf(row);
  if (!cid) return false;
  const inSet = contactsMatchingRelated(rf, ctx).has(cid);
  return rf.quantifier === "any" ? inSet : !inSet;
}
