// The persisted shape of an AI-managed dashboard: tabs of widgets, each widget a
// DECLARATIVE query plus a chart type. Pure and client-safe — the browser, the
// API route and the AI tool definitions all import it.
//
// The one principle everything here serves: the doc stores the QUESTION, never
// the answer. A widget is re-computed by lib/widgets/engine.ts on every visit, so
// it never freezes on the day it was created, and no number in the doc was ever
// written by the model. See docs/superpowers/specs/2026-10-29-paneles-autogestionables-ia-design.md §6.
//
// Two schemas describe the same shape on purpose:
//  - zod (widgetSpecSchema / dashboardDocSchema) validates in the browser and,
//    again, on the server — length and count limits live here;
//  - WIDGET_SPEC_JSON_SCHEMA is what the model sees with `strict: true`, which
//    rejects numeric/length constraints and recursion, requires every property
//    and `additionalProperties: false` on every object. "Not applicable" is null.
// scripts/verify-widgets.ts asserts the two cannot drift apart.
import { z } from "zod";

// ─── Vocabularies ─────────────────────────────────────────────────────────────

export const VIZ_TYPES = [
  "kpi",
  "bar",
  "bar_horizontal",
  "stacked_bar",
  "grouped_bar",
  "line",
  "area",
  "funnel",
  "table",
  "record_list",
  "text",
] as const;
export type VizType = (typeof VIZ_TYPES)[number];

// Messages are a sample and calls are always empty, so neither is a source: a
// widget over a sample would count wrong without saying so.
export const SOURCES = ["contacts", "opportunities", "appointments", "tasks", "pautas", "ads_daily"] as const;
export type SourceId = (typeof SOURCES)[number];

export const ENTITIES = ["contact", "opportunity", "appointment", "task", "pauta"] as const;
export type EntityId = (typeof ENTITIES)[number];

export const SOURCE_ENTITY: Record<Exclude<SourceId, "ads_daily">, EntityId> = {
  contacts: "contact",
  opportunities: "opportunity",
  appointments: "appointment",
  tasks: "task",
  pautas: "pauta",
};

// cost_per_appointment and roas stay out until the owner defines their
// denominators — a metric whose definition nobody agreed on is a wrong number
// waiting to be read as a right one.
export const METRIC_IDS = [
  "count",
  "contacts",
  "value_sum",
  "value_avg",
  "won_count",
  "won_value",
  "win_rate",
  "appointment_rate",
  "show_rate",
  "overdue_tasks",
  "leads_contacts",
  "leads_pauta_opps",
  "leads_pauta_unique",
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "cpl",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export const FILTER_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "is_empty",
  "is_not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const RANGE_PRESETS = [
  "today",
  "last_7d",
  "last_30d",
  "last_90d",
  "this_week",
  "this_month",
  "last_month",
  "this_quarter",
  "ytd",
  "next_7d",
  "next_30d",
  "all",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const BUCKETS = ["day", "week", "month", "quarter", "weekday", "hour"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const SIZES = ["s", "m", "l", "xl"] as const;
export const HEIGHTS = ["compact", "normal", "tall"] as const;
export const COMPARES = ["none", "previous_period", "previous_year"] as const;

export const DOC_LIMITS = {
  maxTabs: 12,
  maxWidgetsPerTab: 24,
  maxDocBytes: 262_144,
  maxTitle: 80,
  maxMetrics: 3,
  maxGroupBy: 2,
  maxLimit: 50,
  maxSeries: 6,
  maxBuckets: 366,
  maxVersions: 50,
  maxControls: 8,
  maxRelatedFilters: 4,
  /** Clauses per filter list (`filters`, `RelatedFilterSpec.conditions`, glossary `meaning`). */
  maxConditions: 5,
  /** Conditions per clause (`FilterClause.anyOf`). */
  maxAnyOf: 5,
  maxGlossary: 50,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

/** One condition. OR across `values`. */
export interface FilterSpec {
  field: string;
  op: FilterOp;
  values: string[];
}

/**
 * An OR of conditions, possibly over DIFFERENT fields. Filter lists are a
 * conjunction of clauses (conjunctive normal form, one level, no recursion), so
 * "lost by status OR by stage, AND pipeline Ventas" is
 * `[{ anyOf: [status eq lost, stage in [...]] }, { anyOf: [pipelineName eq Ventas] }]`.
 */
export interface FilterClause {
  anyOf: FilterSpec[];
}

/**
 * "Rows whose contact has any/none <entity> record matching ALL clauses."
 * The clauses are evaluated on the SAME related record (§6.6).
 */
export interface RelatedFilterSpec {
  entity: EntityId;
  quantifier: "any" | "none";
  conditions: FilterClause[];
}

export interface GroupBySpec {
  dimension: string;
  bucket: Bucket | null;
  join: "latest" | "each" | null;
}

export interface TimeSpec {
  field: string;
  range: "inherit" | RangePreset | "absolute";
  from: string | null;
  to: string | null;
  compare: (typeof COMPARES)[number];
}

export interface QuerySpec {
  source: SourceId;
  metrics: Array<{ metric: MetricId; label: string | null }>;
  groupBy: GroupBySpec[];
  filters: FilterClause[];
  relatedFilters: RelatedFilterSpec[];
  time: TimeSpec;
  globalFilters: "inherit" | "ignore";
  sort: { by: "value" | "label" | "natural"; dir: "asc" | "desc" };
  limit: number | null;
}

export interface WidgetSpec {
  title: string;
  subtitle: string | null;
  viz: VizType;
  size: (typeof SIZES)[number];
  height: (typeof HEIGHTS)[number];
  query: QuerySpec | null;
  text: string | null;
  target: number | null;
  nativeId: string | null;
  prompt: string;
}

export interface Widget extends WidgetSpec {
  id: string;
  createdAt: string;
  createdBy: "ai" | "user";
  updatedAt: string;
}

export interface Tab {
  id: string;
  title: string;
  widgets: Widget[];
}

export interface FilterControl {
  id: string;
  kind: "field" | "condition";
  entity: EntityId;
  label: string;
  field: string | null;
  defaultValues: string[];
  clause: FilterClause | null;
  defaultOn: boolean;
}

export interface PanelFilters {
  defaultDate: RangePreset | null;
  defaultPipelines: string[];
  controls: FilterControl[];
}

export interface GlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  entity: EntityId;
  meaning: FilterClause[];
  note: string;
  createdAt: string;
}

export interface DashboardDoc {
  schemaVersion: 1;
  tabs: Tab[];
  filters: PanelFilters;
  glossary: GlossaryEntry[];
}

// ─── zod ──────────────────────────────────────────────────────────────────────

const L = DOC_LIMITS;

const filterSpecZ = z
  .object({
    field: z.string().min(1).max(120),
    op: z.enum(FILTER_OPS),
    values: z.array(z.string().max(200)).max(100),
  })
  .strict();

export const filterClauseSchema = z
  .object({ anyOf: z.array(filterSpecZ).min(1).max(L.maxAnyOf) })
  .strict();

const relatedFilterZ = z
  .object({
    entity: z.enum(ENTITIES),
    quantifier: z.enum(["any", "none"]),
    conditions: z.array(filterClauseSchema).max(L.maxConditions),
  })
  .strict();

const groupByZ = z
  .object({
    dimension: z.string().min(1).max(120),
    bucket: z.enum(BUCKETS).nullable(),
    join: z.enum(["latest", "each"]).nullable(),
  })
  .strict();

const timeZ = z
  .object({
    field: z.string().min(1).max(40),
    range: z.union([z.literal("inherit"), z.literal("absolute"), z.enum(RANGE_PRESETS)]),
    from: z.string().max(40).nullable(),
    to: z.string().max(40).nullable(),
    compare: z.enum(COMPARES),
  })
  .strict();

const queryZ = z
  .object({
    source: z.enum(SOURCES),
    metrics: z
      .array(z.object({ metric: z.enum(METRIC_IDS), label: z.string().max(L.maxTitle).nullable() }).strict())
      .min(1)
      .max(L.maxMetrics),
    groupBy: z.array(groupByZ).max(L.maxGroupBy),
    filters: z.array(filterClauseSchema).max(L.maxConditions),
    relatedFilters: z.array(relatedFilterZ).max(L.maxRelatedFilters),
    time: timeZ,
    globalFilters: z.enum(["inherit", "ignore"]),
    sort: z.object({ by: z.enum(["value", "label", "natural"]), dir: z.enum(["asc", "desc"]) }).strict(),
    limit: z.number().int().min(1).max(L.maxLimit).nullable(),
  })
  .strict();

const widgetSpecShape = {
  title: z.string().min(1).max(L.maxTitle),
  subtitle: z.string().max(160).nullable(),
  viz: z.enum(VIZ_TYPES),
  size: z.enum(SIZES),
  height: z.enum(HEIGHTS),
  query: queryZ.nullable(),
  text: z.string().max(4000).nullable(),
  target: z.number().nullable(),
  nativeId: z.string().max(60).nullable(),
  prompt: z.string().max(1000),
};

/** The bare object, exposed for `.shape` (key-drift checks); validate with widgetSpecSchema. */
export const widgetSpecObject = z.object(widgetSpecShape).strict();

// A text widget is a note, not a query; every other widget is a query.
function refineVizQuery(s: { viz: VizType; query: unknown; text: string | null }, ctx: z.RefinementCtx): void {
  if (s.viz === "text") {
    if (s.query !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["query"], message: "Un widget de texto no lleva consulta" });
    if (!s.text) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["text"], message: "Un widget de texto necesita texto" });
  } else if (s.query === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["query"], message: `Un widget «${s.viz}» necesita una consulta` });
  }
}

export const widgetSpecSchema: z.ZodType<WidgetSpec> = widgetSpecObject.superRefine(refineVizQuery);

const idZ = z.string().min(1).max(40);
const isoZ = z.string().min(1).max(40);

const widgetZ = z
  .object({
    ...widgetSpecShape,
    id: idZ,
    createdAt: isoZ,
    createdBy: z.enum(["ai", "user"]),
    updatedAt: isoZ,
  })
  .strict()
  .superRefine(refineVizQuery);

const tabZ = z
  .object({
    id: idZ,
    title: z.string().min(1).max(L.maxTitle),
    widgets: z.array(widgetZ).max(L.maxWidgetsPerTab),
  })
  .strict();

const filterControlZ = z
  .object({
    id: idZ,
    kind: z.enum(["field", "condition"]),
    entity: z.enum(ENTITIES),
    label: z.string().min(1).max(L.maxTitle),
    field: z.string().min(1).max(120).nullable(),
    defaultValues: z.array(z.string().max(200)).max(100),
    clause: filterClauseSchema.nullable(),
    defaultOn: z.boolean(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.kind === "field" && c.field === null)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["field"], message: "Un control de campo necesita `field`" });
    if (c.kind === "condition" && c.clause === null)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clause"], message: "Un control de condición necesita `clause`" });
  });

const panelFiltersZ = z
  .object({
    defaultDate: z.enum(RANGE_PRESETS).nullable(),
    defaultPipelines: z.array(z.string().max(60)).max(100),
    controls: z.array(filterControlZ).max(L.maxControls),
  })
  .strict();

const glossaryEntryZ = z
  .object({
    id: idZ,
    term: z.string().min(1).max(L.maxTitle),
    aliases: z.array(z.string().min(1).max(L.maxTitle)).max(10),
    entity: z.enum(ENTITIES),
    meaning: z.array(filterClauseSchema).min(1).max(L.maxConditions),
    note: z.string().max(300),
    createdAt: isoZ,
  })
  .strict();

export const dashboardDocSchema: z.ZodType<DashboardDoc> = z
  .object({
    schemaVersion: z.literal(1),
    tabs: z.array(tabZ).max(L.maxTabs),
    filters: panelFiltersZ,
    glossary: z.array(glossaryEntryZ).max(L.maxGlossary),
  })
  .strict();

export function emptyDoc(): DashboardDoc {
  return {
    schemaVersion: 1,
    tabs: [],
    filters: { defaultDate: null, defaultPipelines: [], controls: [] },
    glossary: [],
  };
}

/**
 * Reads a doc that came from storage or the network. Docs live for years —
 * unlike the disposable sync cache — so a version this code does not know is an
 * error, never a best-effort guess. Future versions migrate here before parsing.
 */
export function parseDoc(raw: unknown): DashboardDoc {
  const version = raw && typeof raw === "object" ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version !== 1) throw new Error(`Versión de panel desconocida: ${String(version)}`);
  return dashboardDocSchema.parse(raw);
}

// ─── JSON Schema for the model (strict tool use) ──────────────────────────────

const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const enumOf = (values: readonly string[], description?: string) => ({
  type: "string",
  enum: [...values],
  ...(description ? { description } : {}),
});
const obj = (properties: Record<string, unknown>, description?: string) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  ...(description ? { description } : {}),
});
const arr = (items: Record<string, unknown>, description?: string) => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
});

export const FILTER_SPEC_JSON_SCHEMA = obj({
  field: str(
    "Field of the record being filtered: a native field ('status', 'stage', 'pipelineName', 'assignedTo', 'source', 'tags'…), a derived one ('won', 'dePauta', 'funnelState', 'platform', 'sourceCategory', 'campaignResolved') or a custom field as 'cf:<Field Name>'."
  ),
  op: enumOf(FILTER_OPS),
  values: arr(str(), "Values to compare against. OR across values. Empty for is_empty / is_not_empty."),
});

export const FILTER_CLAUSE_JSON_SCHEMA = obj(
  { anyOf: arr(FILTER_SPEC_JSON_SCHEMA, "1 to 5 conditions, OR'ed. They may be on different fields.") },
  "An OR of conditions. A list of clauses is AND'ed."
);

const QUERY_JSON_SCHEMA = obj({
  source: enumOf(SOURCES, "The records the widget counts. ads_daily = Meta ad spend days (account level)."),
  metrics: arr(
    obj({ metric: enumOf(METRIC_IDS), label: nullable(str()) }),
    "1 to 3 metrics from the catalog. Never invent formulas."
  ),
  groupBy: arr(
    obj({
      dimension: str(
        "Field to group by: native/derived/'cf:<Name>' of the source, a related field via the contact ('opportunity.stage', 'contact.source', 'contact.cf:<Name>'), or a date field ('createdAt', 'closedAt', 'startTime', 'dueDate', 'date') together with a bucket."
      ),
      bucket: nullable(enumOf(BUCKETS, "Only for date dimensions.")),
      join: nullable(
        enumOf(
          ["latest", "each"],
          "Only for 'opportunity.*' dimensions: 'latest' = the contact's most recent opportunity (bars add up to the row count); 'each' = once per opportunity."
        )
      ),
    }),
    "0 to 2 dimensions. The second one is the series."
  ),
  filters: arr(FILTER_CLAUSE_JSON_SCHEMA, "Clauses on the source's own fields, AND'ed."),
  relatedFilters: arr(
    obj({
      entity: enumOf(ENTITIES),
      quantifier: enumOf(["any", "none"]),
      conditions: arr(FILTER_CLAUSE_JSON_SCHEMA, "Clauses evaluated on the SAME related record. Empty = has any / has none."),
    }),
    "Cross-object filters through the contact, e.g. contacts with any lost opportunity. 0 to 4."
  ),
  time: obj({
    field: str("Date field used for the range: createdAt | closedAt | updatedAt | startTime | dueDate | date."),
    range: enumOf(["inherit", "absolute", ...RANGE_PRESETS], "'inherit' follows the panel's date filter."),
    from: nullable(str("ISO date, only with 'absolute'.")),
    to: nullable(str("ISO date, only with 'absolute'.")),
    compare: enumOf(COMPARES, "KPI delta against an earlier period."),
  }),
  globalFilters: enumOf(["inherit", "ignore"], "Whether the panel's pipeline and added filters apply."),
  sort: obj({ by: enumOf(["value", "label", "natural"]), dir: enumOf(["asc", "desc"]) }),
  limit: nullable({ type: "integer", description: "Top N (max 50); the rest is folded into 'Otros'." }),
});

export const WIDGET_SPEC_JSON_SCHEMA: Record<string, unknown> = obj({
  title: str("Short Spanish title, max 80 chars."),
  subtitle: nullable(str()),
  viz: enumOf(VIZ_TYPES),
  size: enumOf(SIZES, "Width: s=3, m=6, l=8, xl=12 of 12 columns."),
  height: enumOf(HEIGHTS),
  query: nullable(QUERY_JSON_SCHEMA),
  text: nullable(str("Markdown body, only for viz 'text'.")),
  target: nullable({ type: "number", description: "Goal value, only for a meter." }),
  nativeId: nullable(str("Reserved. Always null for now.")),
  prompt: str("The user's request that led to this widget, verbatim."),
});
