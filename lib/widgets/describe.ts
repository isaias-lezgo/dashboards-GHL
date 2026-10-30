// Plain-Spanish descriptions of the panel, deterministic so they can sit in a
// prompt without busting its cache. One function, two readers:
//  - the ScopePill on every widget card, which keeps the rule of the widget
//    VISIBLE to the person reading it (the main defense against the model
//    picking the wrong date base or join rule, spec §4.2);
//  - the panel snapshot the model reads on every turn (spec §9.1).
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { SOURCE_ENTITY, type DashboardDoc, type EntityId, type FilterClause, type FilterSpec, type QuerySpec, type WidgetSpec } from "./spec";
import { SOURCE_DEFS, isDateField, knownCustomFields, type EngineContext } from "./semantic";
import { ENTITY_NOUNS, METRIC_PHRASES, RANGE_LABELS, SOURCE_LABELS, VIZ_LABELS, fieldLabel, valueLabel } from "./labels";

export const PANEL_SNAPSHOT_MARKER = "=== PANEL ACTUAL ===";

const BUCKET_PHRASES: Record<string, string> = {
  day: "día",
  week: "semana",
  month: "mes",
  quarter: "trimestre",
  weekday: "día de la semana",
  hour: "hora",
};

function conditionText(entity: EntityId | null, f: FilterSpec): string {
  const label = fieldLabel(f.field);
  const values = f.values.map((v) => valueLabel(entity, f.field, v)).join(" o ");
  switch (f.op) {
    case "eq":
    case "in":
      return `${label} = ${values}`;
    case "neq":
    case "not_in":
      return `${label} ≠ ${values}`;
    case "contains":
      return `${label} contiene ${values}`;
    case "is_empty":
      return `${label} vacío`;
    case "is_not_empty":
      return `${label} con valor`;
    case "gt":
      return `${label} > ${f.values[0]}`;
    case "gte":
      return `${label} ≥ ${f.values[0]}`;
    case "lt":
      return `${label} < ${f.values[0]}`;
    case "lte":
      return `${label} ≤ ${f.values[0]}`;
  }
}

function clauseText(entity: EntityId | null, c: FilterClause): string {
  const parts = c.anyOf.map((f) => conditionText(entity, f));
  return parts.length > 1 ? `(${parts.join(" o ")})` : parts[0];
}

function clausesText(entity: EntityId | null, clauses: FilterClause[]): string {
  return clauses.map((c) => clauseText(entity, c)).join(" y ");
}

function groupText(q: QuerySpec): string | null {
  if (q.groupBy.length === 0) return null;
  const parts = q.groupBy.map((g) => {
    if (g.dimension.startsWith("opportunity.")) {
      const label = fieldLabel(g.dimension.slice("opportunity.".length));
      return g.join === "each"
        ? `por ${label} de la oportunidad (cuenta una vez por cada oportunidad)`
        : `por ${label} de la oportunidad más reciente`;
    }
    if (g.dimension.startsWith("contact.")) return `por ${fieldLabel(g.dimension.slice("contact.".length))} del contacto`;
    if (isDateField(q.source, g.dimension)) {
      const bucket = BUCKET_PHRASES[g.bucket ?? "day"];
      return g.dimension === SOURCE_DEFS[q.source].primaryDate ? `por ${bucket}` : `por ${bucket} (${fieldLabel(g.dimension)})`;
    }
    return `por ${fieldLabel(g.dimension)}`;
  });
  return parts.join(" y ");
}

function periodText(q: QuerySpec): string {
  let text: string;
  if (q.time.range === "inherit") text = "hereda fechas";
  else if (q.time.range === "absolute") {
    const from = q.time.from ? parseISO(q.time.from) : null;
    const to = q.time.to ? parseISO(q.time.to) : from;
    text =
      from && to
        ? `${format(from, "d MMM", { locale: es })} – ${format(to, "d MMM yyyy", { locale: es })}`
        : "periodo sin fechas";
  } else text = RANGE_LABELS[q.time.range];
  if (q.time.field !== SOURCE_DEFS[q.source].primaryDate) text += ` por ${fieldLabel(q.time.field)}`;
  if (q.time.compare === "previous_period") text += " vs. periodo anterior";
  if (q.time.compare === "previous_year") text += " vs. año anterior";
  return text;
}

/** A widget's rule in one line, e.g. "Citas · conteo · por etapa de la oportunidad más reciente · hereda fechas". */
export function describeWidget(spec: WidgetSpec): string {
  const q = spec.query;
  if (!q) return "Nota";
  const parts: string[] = [SOURCE_LABELS[q.source]];
  if (spec.viz !== "record_list") parts.push(q.metrics.map((m) => METRIC_PHRASES[m.metric]).join(" y "));
  const group = groupText(q);
  if (group) parts.push(group);
  const sourceEntity = q.source === "ads_daily" ? null : SOURCE_ENTITY[q.source];
  if (q.filters.length) parts.push(`solo ${clausesText(sourceEntity, q.filters)}`);
  for (const rf of q.relatedFilters) {
    const noun = ENTITY_NOUNS[rf.entity];
    const cond = rf.conditions.length ? ` con ${clausesText(rf.entity, rf.conditions)}` : "";
    const masc = rf.entity === "contact";
    parts.push(rf.quantifier === "any" ? `con ${masc ? "algún" : "alguna"} ${noun}${cond}` : `sin ${masc ? "ningún" : "ninguna"} ${noun}${cond}`);
  }
  parts.push(periodText(q));
  if (q.source === "ads_daily") parts.push("ignora los filtros de CRM");
  else if (q.globalFilters === "ignore") parts.push("ignora los filtros del panel");
  return parts.join(" · ");
}

const capitalize = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t);

/**
 * The widget's OWN filters as short chips under its title: a fixed period
 * ("Mes pasado · fijo"), own-field clauses, cross-object filters. Global filters
 * are not here — they live in the panel's bar.
 */
export function describeFilterChips(spec: WidgetSpec): string[] {
  const q = spec.query;
  if (!q) return [];
  const chips: string[] = [];
  if (q.time.range !== "inherit") {
    const period = q.time.range === "absolute" ? periodText({ ...q, time: { ...q.time, compare: "none" } }) : RANGE_LABELS[q.time.range];
    chips.push(`${capitalize(period)} · fijo`);
  }
  const sourceEntity = q.source === "ads_daily" ? null : SOURCE_ENTITY[q.source];
  for (const c of q.filters) chips.push(capitalize(clauseText(sourceEntity, c)));
  for (const rf of q.relatedFilters) {
    const noun = ENTITY_NOUNS[rf.entity];
    const masc = rf.entity === "contact";
    const cond = rf.conditions.length ? ` con ${clausesText(rf.entity, rf.conditions)}` : "";
    chips.push(capitalize(rf.quantifier === "any" ? `con ${masc ? "algún" : "alguna"} ${noun}${cond}` : `sin ${masc ? "ningún" : "ninguna"} ${noun}${cond}`));
  }
  return chips;
}

/**
 * What the model sees of the panel on every turn, appended to the user's
 * message (never to `system`, which would bust the cached prefix). Ids are in
 * brackets so the model can reference them; it is told never to print them.
 */
export function buildPanelSnapshot(
  doc: DashboardDoc,
  activeTabId: string | null,
  selectedWidgetId: string | null,
  filtersLine: string
): string {
  const lines = [PANEL_SNAPSHOT_MARKER];
  const active = doc.tabs.find((t) => t.id === activeTabId) ?? null;
  lines.push(active ? `Pestaña activa: "${active.title}" [${active.id}]` : "Pestaña activa: ninguna (panel vacío)");
  lines.push(`Filtros del panel: ${filtersLine}`);
  lines.push(
    doc.tabs.length
      ? `Pestañas: ${doc.tabs.map((t) => `${t.title} (${t.widgets.length}) [${t.id}]`).join(" · ")}`
      : "Pestañas: ninguna"
  );
  if (active) {
    lines.push(`Widgets de "${active.title}":`);
    if (active.widgets.length === 0) lines.push(" (vacía)");
    for (const w of active.widgets) {
      lines.push(` - [${w.id}] ${VIZ_LABELS[w.viz]} "${w.title}" (${w.size}) · ${describeWidget(w)}`);
    }
  }
  if (selectedWidgetId) lines.push(`Seleccionado: [${selectedWidgetId}]`);
  if (doc.glossary.length) {
    lines.push(
      `Glosario del cliente: ${doc.glossary.map((g) => `«${g.term}» (${ENTITY_NOUNS[g.entity]}) = ${g.note}`).join(" · ")}`
    );
  }
  return lines.join("\n");
}

/** Per-session catalog for the cached system block: stable for the same data. */
export function buildPanelCatalogSummary(ctx: EngineContext): string {
  const lines = ["=== CATÁLOGO DEL PANEL ==="];
  if (ctx.pipelines.length) {
    lines.push("Pipelines y etapas (en el orden de GHL):");
    for (const p of ctx.pipelines) lines.push(`  - "${p.name}": ${p.stages.join(" → ") || "(sin etapas)"}`);
  }
  const cfLine = (label: string, source: "contacts" | "opportunities") => {
    const names = [...knownCustomFields(source, ctx)].sort((a, b) => a.localeCompare(b, "es"));
    if (names.length) lines.push(`Campos personalizados de ${label} (úsalos como "cf:<Nombre>"): ${names.join(", ")}`);
  };
  cfLine("contacto", "contacts");
  cfLine("oportunidad", "opportunities");
  const statuses = [...new Set(ctx.dataset.appointments.map((a) => a.status))].sort();
  if (statuses.length) lines.push(`Estados de cita: ${statuses.join(", ")}`);
  const ads = ctx.ads;
  if (!ads) lines.push("Meta: sin revisar todavía (el gasto aún no se ha sincronizado para esta cuenta).");
  else if (ads.status === "connected") {
    lines.push(`Meta: conectado${ads.currency ? `, moneda ${ads.currency}` : ""}${ads.from && ads.to ? `, gasto del ${ads.from} al ${ads.to}` : ""}.`);
  } else lines.push(`Meta: ${ads.status}${ads.message ? ` — ${ads.message}` : ""}. No hay gasto disponible.`);
  return lines.join("\n");
}
