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
import { cfLookup, cfValues, customFieldName, type CustomFieldsResolved } from "@/lib/custom-fields";
import { differenceInCalendarDays, parseISO } from "date-fns";
import type { ConversationState } from "@/lib/conversation-index";
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
  /** GHL's dataType per custom field ("<model>:<name>"). null/absent = the cache predates it. */
  customFieldTypes?: Record<string, string> | null;
  /** Conversations, loaded on demand (hooks/use-conversation-index.ts). Absent = never asked for. */
  conversations?: ConversationState;
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
    /** "pending": the data it needs has not arrived yet (cache without field types, conversations loading). */
    public code: "unknown_field" | "unsupported" | "invalid" | "pending",
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
    // lastOutboundAt / lastMessageAt come from the conversation index (messageDate).
    dateFields: ["createdAt", "lastOutboundAt", "lastMessageAt"],
    primaryDate: "createdAt",
    contactIdOf: (r) => str(r.id),
    rows: (ctx) => asRows(ctx.dataset.contacts),
  },
  opportunities: {
    dateFields: ["createdAt", "closedAt", "updatedAt", "lastStageChangeAt", "lastStatusChangeAt"],
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
  // Only a READY index has rows; the engine never measures a loading one.
  conversations: {
    dateFields: ["lastMessageAt", "createdAt", "lastOutboundAt"],
    primaryDate: "lastMessageAt",
    contactIdOf: (r) => str(r.contactId),
    rows: (ctx) => (ctx.conversations?.status === "ready" ? asRows(ctx.conversations.rows) : []),
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
    // Filterable too ("sin cambio de etapa hace 16 días"), not only bucketable.
    "lastStageChangeAt", "lastStatusChangeAt",
  ],
  appointments: ["id", "contactId", "assignedTo", "title", "status", "startTime", "endTime"],
  tasks: ["id", "title", "status", "assignedTo", "assignedToName", "contactId", "opportunityId", "dueDate", "createdAt"],
  pautas: ["id", "tipo", "nombrePauta", "contactId", "createdAt"],
  ads_daily: ["date"],
  conversations: ["channel", "assignedTo", "lastDirection", "unreadCount", "waitingReply", "lastMessageAt", "createdAt", "lastOutboundAt", "contactId"],
};

export const DERIVED_FIELDS: Partial<Record<SourceId, string[]>> = {
  contacts: ["lastOutboundAt", "lastMessageAt"],
  opportunities: ["dePauta", "campaignResolved", "won", "funnelState", "sourceCategory", "platform", "outcome"],
};

const CF_SOURCES: SourceId[] = ["contacts", "opportunities"];

/** Filterable fields per object, with the Spanish label the UI and ScopePill use. */
export const ENTITY_FIELDS: Record<EntityId, { field: string; label: string }[]> = {
  opportunity: [
    { field: "pipelineName", label: "Pipeline" },
    { field: "stage", label: "Etapa" },
    { field: "status", label: "Estado" },
    { field: "won", label: "Ganada" },
    { field: "outcome", label: "Estado (ganada/abierta/perdida)" },
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

const CF_MODEL: Partial<Record<SourceId, string>> = { contacts: "contact", opportunities: "opportunity" };

/** GHL's dataType of a custom field of this source, or null (no custom fields here, or a cache without types). */
export function customFieldType(source: SourceId, cfName: string, ctx: EngineContext): string | null {
  const model = CF_MODEL[source];
  const types = ctx.customFieldTypes;
  if (!model || !types) return null;
  const want = `${model}:${cfName}`.toLowerCase();
  for (const [k, v] of Object.entries(types)) if (k.toLowerCase() === want) return v;
  return null;
}

/**
 * Is `field` a date of `source`? Native dates, a custom field GHL types as DATE
 * (never one whose text merely looks like a date), or a contact date reached
 * from a source that has a contact ("contact.createdAt").
 */
export function isDateField(source: SourceId, field: string, ctx?: EngineContext): boolean {
  if (field.startsWith("contact.")) {
    return source !== "contacts" && source !== "ads_daily" && isDateField("contacts", field.slice("contact.".length), ctx);
  }
  if (field.startsWith("opportunity.")) return false;
  const cf = customFieldName(field);
  if (cf) return !!ctx && customFieldType(source, cf, ctx) === "DATE";
  return SOURCE_DEFS[source].dateFields.includes(field) || field === "lastActivity" || field === "dateUpdated";
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const EPOCH_MS = /^\d{9,13}$/;

/** A native date value: ISO, a bare "yyyy-MM-dd" (local day), or epoch milliseconds as a number or a numeric string. */
export function toDate(v: unknown): Date | null {
  if (typeof v === "number") return Number.isFinite(v) ? new Date(v) : null;
  if (typeof v !== "string" || !v) return null;
  const d = DATE_ONLY.test(v) ? parseISO(v) : EPOCH_MS.test(v) ? new Date(Number(v)) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The date a row holds for `field`. A DATE custom field is a CALENDAR day that
 * GHL stores at UTC midnight, so it is read in UTC and returned as that local
 * day — read in local time, the 1st of a month lands in the previous month.
 */
export function dateValue(source: SourceId, row: Row, field: string, ctx: ResolvedCtx): Date | null {
  if (isMessageDateField(source, field)) {
    const d = messageDate(source, row, field, ctx);
    return d instanceof Date ? d : null;
  }
  if (field.startsWith("contact.")) {
    const cid = SOURCE_DEFS[source].contactIdOf(row);
    const contact = cid ? ctx.index.contactById.get(cid) : undefined;
    return contact ? dateValue("contacts", contact as unknown as Row, field.slice("contact.".length), ctx) : null;
  }
  const cf = customFieldName(field);
  if (cf) {
    if (customFieldType(source, cf, ctx) !== "DATE") return null;
    const raw: unknown = cfLookup(row.customFieldsResolved as CustomFieldsResolved, cf);
    const d = toDate(Array.isArray(raw) ? raw[0] : raw);
    return d ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : null;
  }
  return toDate(row[field]);
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
export type Outcome = "Ganada" | "Abierta" | "Perdida";
export const OUTCOME_ORDER: Outcome[] = ["Ganada", "Abierta", "Perdida"];

/** The three-way state the hand-built dashboards stack by: won (isWonOpp), lost or abandoned, or still open. */
export function outcomeOf(opp: Opportunity): Outcome {
  if (isWonOpp(opp)) return "Ganada";
  if (opp.status === "lost" || opp.status === "abandoned") return "Perdida";
  return "Abierta";
}

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
    case "outcome":
      return outcomeOf(opp);
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

// ─── Message dates (the conversation index) ───────────────────────────────────

/** A contact's dates that live in the conversation index, not in the CRM sync. */
export const MESSAGE_DATE_FIELDS = ["lastOutboundAt", "lastMessageAt"];

/** Does `field` of `source` read the conversation index? */
export function isMessageDateField(source: SourceId, field: string): boolean {
  if (source === "conversations") return field === "lastOutboundAt";
  if (source === "contacts") return MESSAGE_DATE_FIELDS.includes(field);
  if (field.startsWith("contact.") && source !== "ads_daily") return MESSAGE_DATE_FIELDS.includes(field.slice("contact.".length));
  return false;
}

/**
 * A message date, or "beyond": the index is ready but holds no such message
 * for the contact — nothing in the window, so it is older than the window or
 * never happened. null = the index is not ready (the engine never gets here
 * then: it returns a pending result first).
 */
export function messageDate(source: SourceId, row: Row, field: string, ctx: EngineContext): Date | "beyond" | null {
  const state = ctx.conversations;
  if (state?.status !== "ready") return null;
  if (source === "conversations") return toDate(row[field]) ?? "beyond";
  const name = field.startsWith("contact.") ? field.slice("contact.".length) : field;
  const cid = source === "contacts" ? str(row.id) : SOURCE_DEFS[source].contactIdOf(row);
  const v = cid ? state.byContact.get(cid)?.[name as "lastOutboundAt" | "lastMessageAt"] : null;
  return (v && toDate(v)) || "beyond";
}

/**
 * A combined field: the values of the first field in `fields` that holds any.
 * From a source with a contact, "contact.<field>" reads the contact. The same
 * rule groups AND filters, so a record whose two fields disagree is counted
 * under the first one everywhere.
 */
export function fieldValuesWithFallbacks(source: SourceId, row: Row, fields: string[], ctx: ResolvedCtx): string[] {
  for (const f of fields) {
    let vals: string[];
    if (f.startsWith("contact.") && source !== "contacts") {
      const cid = SOURCE_DEFS[source].contactIdOf(row);
      const contact = cid ? ctx.index.contactById.get(cid) : undefined;
      vals = contact ? dimensionValues("contacts", contact as unknown as Row, f.slice("contact.".length), ctx) : [EMPTY_VALUE];
    } else {
      vals = dimensionValues(source, row, f, ctx);
    }
    if (!vals.every(isEmptyValue)) return vals;
  }
  return [EMPTY_VALUE];
}

// ─── Filters ──────────────────────────────────────────────────────────────────

const lc = (s: string): string => s.trim().toLowerCase();
const isEmptyValue = (v: string): boolean => v === EMPTY_VALUE || v === EMPTY_TAG;

/** One condition against a row of `source`. Case-insensitive; `in`/`eq` = any of values. */
export function matchesFilter(source: SourceId, row: Row, f: FilterSpec, ctx: ResolvedCtx): boolean {
  const have = f.fallbacks?.length
    ? fieldValuesWithFallbacks(source, row, [f.field, ...f.fallbacks], ctx)
    : dimensionValues(source, row, f.field, ctx);
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
      if (f.values.length === 0) return false;
      if (isDateField(source, f.field, ctx)) {
        const a = dateValue(source, row, f.field, ctx)?.getTime();
        const b = toDate(f.values[0])?.getTime();
        if (a === undefined || b === undefined) return false;
        if (f.op === "gt") return a > b;
        if (f.op === "gte") return a >= b;
        if (f.op === "lt") return a < b;
        return a <= b;
      }
      if (have.every(isEmptyValue)) return false;
      const a = Number(have[0]);
      const b = Number(f.values[0]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (f.op === "gt") return a > b;
      if (f.op === "gte") return a >= b;
      if (f.op === "lt") return a < b;
      return a <= b;
    }
    case "days_ago_gte":
    case "days_ago_lte": {
      const n = Number(f.values[0]);
      if (isMessageDateField(source, f.field)) {
        // "beyond" = no message in the window: at least window days ago, or never.
        const md = messageDate(source, row, f.field, ctx);
        if (md === "beyond") return f.op === "days_ago_gte" && ctx.conversations?.status === "ready" && n <= ctx.conversations.days;
      }
      const d = dateValue(source, row, f.field, ctx);
      if (!d || !Number.isFinite(n)) return false;
      const days = differenceInCalendarDays(ctx.now, d);
      return f.op === "days_ago_gte" ? days >= n : days >= 0 && days <= n;
    }
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

/** Distinct values of an object's field over ALL its records, most frequent first. With fallbacks: of the combined field. */
export function listFieldValues(entity: EntityId, field: string, ctx: ResolvedCtx, fallbacks: string[] = []): { value: string; count: number }[] {
  const source = ENTITY_SOURCE[entity];
  const counts = new Map<string, number>();
  for (const r of SOURCE_DEFS[source].rows(ctx)) {
    const vals = fallbacks.length ? fieldValuesWithFallbacks(source, r, [field, ...fallbacks], ctx) : dimensionValues(source, r, field, ctx);
    for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
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
  // The conversation index joins the key: a set computed on 60 days of messages
  // must not answer for 120.
  const conv = ctx.conversations?.status === "ready" ? `${ctx.conversations.days}:${ctx.conversations.rows.length}` : "none";
  const key = JSON.stringify({ e: rf.entity, c: rf.conditions, conv });
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
