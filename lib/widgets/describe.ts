// Plain-Spanish descriptions of the panel, deterministic so they can sit in a
// prompt without busting its cache. One function, two readers:
//  - the ScopePill on every widget card, which keeps the rule of the widget
//    VISIBLE to the person reading it (the main defense against the model
//    picking the wrong date base or join rule, spec §4.2);
//  - the panel snapshot the model reads on every turn (spec §9.1).
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { entityOf, fallbacksOf, glossaryKind, seriesOf, type DashboardDoc, type EntityId, type FilterClause, type FilterSpec, type QuerySpec, type RelatedFilterSpec, type SeriesSpec, type WidgetSpec } from "./spec";
import { primarySeries, ratioKind } from "./engine";
import { SOURCE_DEFS, isDateField, knownCustomFields, type EngineContext } from "./semantic";
import { cfValues } from "@/lib/custom-fields";
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

const fieldName = (f: string): string => (f.startsWith("contact.") ? `${fieldLabel(f.slice("contact.".length))} del contacto` : fieldLabel(f));

function conditionText(entity: EntityId | null, f: FilterSpec): string {
  const fb = fallbacksOf(f);
  const label = fb.length ? `${fieldLabel(f.field)} (o ${fb.map(fieldName).join(" o ")})` : fieldLabel(f.field);
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
    case "days_ago_gte":
      return `${label} hace ≥ ${f.values[0]} días`;
    case "days_ago_lte":
      return `${label} en los últimos ${f.values[0]} días`;
  }
}

function clauseText(entity: EntityId | null, c: FilterClause): string {
  const parts = c.anyOf.map((f) => conditionText(entity, f));
  return parts.length > 1 ? `(${parts.join(" o ")})` : parts[0];
}

/** One clause in words: conditions joined with "o", wrapped in parentheses when there are several. */
export const describeClause = (entity: EntityId | null, c: FilterClause): string => clauseText(entity, c);

function clausesText(entity: EntityId | null, clauses: FilterClause[]): string {
  return clauses.map((c) => clauseText(entity, c)).join(" y ");
}

/** "días desde …": the event each date marks, with its article. */
const AGE_PHRASES: Record<string, string> = {
  lastStageChangeAt: "el último cambio de etapa",
  lastStatusChangeAt: "el último cambio de estado",
  lastOutboundAt: "nuestro último mensaje",
  lastMessageAt: "el último mensaje",
  createdAt: "la creación",
  closedAt: "el cierre",
  dueDate: "el vencimiento",
  startTime: "la cita",
};

function groupText(q: QuerySpec, viz?: WidgetSpec["viz"]): string | null {
  if (q.groupBy.length === 0) return null;
  const parts = q.groupBy.map((g) => {
    if (g.bucket === "age") {
      const field = g.dimension.replace(/^(contact|opportunity)\./, "");
      return `días desde ${AGE_PHRASES[field] ?? `«${fieldLabel(field)}»`}`;
    }
    const fb = fallbacksOf(g);
    if (fb.length) return `por ${fieldName(g.dimension)} (o ${fb.map(fieldName).join(" o ")})`;
    if (g.dimension.startsWith("opportunity.")) {
      const label = fieldLabel(g.dimension.slice("opportunity.".length));
      return g.join === "each"
        ? `por ${label} de la oportunidad (cuenta una vez por cada oportunidad)`
        : `por ${label} de la oportunidad más reciente`;
    }
    if (g.dimension.startsWith("contact.")) return `por ${fieldLabel(g.dimension.slice("contact.".length))} del contacto`;
    if (g.bucket || isDateField(q.source, g.dimension)) {
      const bucket = BUCKET_PHRASES[g.bucket ?? "day"];
      return g.dimension === SOURCE_DEFS[q.source].primaryDate ? `por ${bucket}` : `por ${bucket} (${fieldLabel(g.dimension)})`;
    }
    return `por ${fieldLabel(g.dimension)}`;
  });
  return parts.join(viz === "matrix" ? " × " : " y ");
}

function relatedText(rf: RelatedFilterSpec): string {
  const noun = ENTITY_NOUNS[rf.entity];
  const cond = rf.conditions.length ? ` con ${clausesText(rf.entity, rf.conditions)}` : "";
  const masc = rf.entity === "contact";
  return rf.quantifier === "any" ? `con ${masc ? "algún" : "alguna"} ${noun}${cond}` : `sin ${masc ? "ningún" : "ninguna"} ${noun}${cond}`;
}

/** "Oportunidades (oportunidades por fecha de creación, solo …)": one series of a multi-series widget. */
function seriesText(s: SeriesSpec): string {
  const bits = [`${SOURCE_LABELS[s.source].toLowerCase()} por ${fieldLabel(s.dateField)}`];
  if (s.filters.length) bits.push(`solo ${clausesText(entityOf(s.source), s.filters)}`);
  for (const rf of s.relatedFilters) bits.push(relatedText(rf));
  return `${s.label} (${bits.join(", ")})`;
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
  const parts: string[] = [];
  if (seriesOf(q).length || q.ratio) {
    // Several series: each with its own source, date and conditions; a ratio says what it divides.
    const all = [primarySeries(q), ...seriesOf(q)];
    parts.push(all.map(seriesText).join(" y "));
    const n = q.ratio ? all[q.ratio.numerator] : undefined;
    const d = q.ratio ? all[q.ratio.denominator] : undefined;
    if (q.ratio && n && d) {
      const kind = ratioKind(n, d) === "same_group" ? "mismo grupo, cuenta hasta hoy" : "cociente entre registros distintos";
      parts.push(`${q.ratio.label} = ${n.label} ÷ ${d.label} (${kind})`);
    }
    const group = groupText(q, spec.viz);
    if (group) parts.push(group);
  } else {
    parts.push(SOURCE_LABELS[q.source]);
    if (spec.viz !== "record_list") parts.push(q.metrics.map((m) => METRIC_PHRASES[m.metric]).join(" y "));
    const group = groupText(q, spec.viz);
    if (group) parts.push(group);
    const sourceEntity = entityOf(q.source);
    if (q.filters.length) parts.push(`solo ${clausesText(sourceEntity, q.filters)}`);
    for (const rf of q.relatedFilters) parts.push(relatedText(rf));
  }
  parts.push(periodText(q));
  if (q.conversationDays && q.conversationDays !== 60) parts.push(`conversaciones de ${q.conversationDays} días`);
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
  const sourceEntity = entityOf(q.source);
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
    // The clauses go verbatim: rebuilt from the prose note, "estado perdida"
    // becomes status = "perdida" instead of "lost" — a valid field, a zero count.
    lines.push("Glosario del cliente (usa estas cláusulas tal cual):");
    for (const g of doc.glossary) {
      if (glossaryKind(g) === "field") lines.push(` - «${g.term}» (campo) = ${(g.fields ?? []).join(" → ")}`);
      else lines.push(` - «${g.term}» (${ENTITY_NOUNS[g.entity]}) = ${g.note} · cláusulas: ${JSON.stringify(g.meaning)}`);
    }
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
  // Only fields GHL types as DATE are dates: text that looks like a date is not one.
  if (!ctx.customFieldTypes) {
    lines.push("Campos de fecha personalizados: disponibles después de la próxima actualización.");
  } else {
    const dates = Object.entries(ctx.customFieldTypes)
      .filter(([, t]) => t === "DATE")
      .map(([k]) => {
        const [model, ...rest] = k.split(":");
        const name = rest.join(":");
        // How many records hold it: a DATE field nobody fills is a "Sin fecha" chart.
        const rows: Array<{ customFieldsResolved?: Record<string, string | string[]> }> = model === "opportunity" ? ctx.dataset.opportunities : ctx.dataset.contacts;
        const filled = rows.filter((r) => cfValues(r.customFieldsResolved, name).length > 0).length;
        const pct = rows.length ? Math.round((100 * filled) / rows.length) : 0;
        return `cf:${name} (${model === "opportunity" ? "oportunidad" : "contacto"}, ${pct}% con dato)`;
      })
      .sort((a, b) => a.localeCompare(b, "es"));
    if (dates.length) lines.push(`Campos de fecha personalizados: ${dates.join(", ")}`);
  }
  // A native date GHL leaves empty in this account (closedAt on many) would put
  // every record in "Sin fecha": say which ones hold data so the model picks one.
  const opps = ctx.dataset.opportunities;
  if (opps.length) {
    const share = (f: "createdAt" | "closedAt" | "lastStatusChangeAt" | "lastStageChangeAt") =>
      `${f} ${Math.round((100 * opps.filter((o) => !!o[f]).length) / opps.length)}%`;
    lines.push(
      `Fechas de oportunidad con dato en esta cuenta: ${share("createdAt")}, ${share("closedAt")}, ${share("lastStatusChangeAt")}, ${share("lastStageChangeAt")}. lastStatusChangeAt = cuando cambió el estado (para una ganada, cuándo se ganó).`
    );
  }
  lines.push(
    "Conversaciones: fuente «conversations» (canal, asesor, último mensaje, esperando respuesta) y fechas del contacto lastOutboundAt (nuestro último mensaje) y lastMessageAt; se cargan bajo demanda, 60 días por omisión."
  );
  const statuses = [...new Set(ctx.dataset.appointments.map((a) => a.status))].sort();
  if (statuses.length) lines.push(`Estados de cita: ${statuses.join(", ")}`);
  const ads = ctx.ads;
  if (!ads) lines.push("Meta: sin revisar todavía (el gasto aún no se ha sincronizado para esta cuenta).");
  else if (ads.status === "connected") {
    lines.push(`Meta: conectado${ads.currency ? `, moneda ${ads.currency}` : ""}${ads.from && ads.to ? `, gasto del ${ads.from} al ${ads.to}` : ""}.`);
  } else lines.push(`Meta: ${ads.status}${ads.message ? ` — ${ads.message}` : ""}. No hay gasto disponible.`);
  return lines.join("\n");
}
