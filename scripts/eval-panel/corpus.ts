// Natural-language eval of the panel copilot (spec §14): 30 requests in Spanish
// and what a correct panel looks like after each. Run with scripts/eval-panel/run.ts.
//
// Each `reference` is written with plain filters over the payload's arrays and
// does NOT run lib/widgets/* code (type imports only): a reference that used
// the engine would grade itself. The concept cases were picked from the real
// data of the two eval accounts on 2026-10-30 (resolve_term over their cached
// payloads), not invented:
//   - amir-cherit «perdido»: stage "Negocio Perdido" (825 contacts) and status
//     lost (811) overlap on only 676 → two materially different readings.
//   - lezgo-suite «clientes activos»: stage "Cliente Activo" (38), tag
//     "cliente-activo" (33), field "Etapa del negocio" (15), 26 in common.
//   - amir-cherit «spam»: one place only, tag "mandar a spam".
//   - «inversionistas»: nowhere in either account.
import { endOfMonth, format, startOfMonth } from "date-fns";
import { isWonOpp } from "../../lib/opportunity-status";
import type { Contact, Opportunity } from "../../lib/types";
import type { EngineContext } from "../../lib/widgets/semantic";
import type { DashboardDoc, GlossaryEntry, QuerySpec, VizType, WidgetSpec } from "../../lib/widgets/spec";
import type { PanelFilterState } from "../../lib/widgets/filter-state";

export type Expectation =
  /** A widget is created (or the selected one edited) and, when given, matches `reference` / `check`. */
  | "widget"
  /** Same, and the copilot did NOT ask (a glossary or single-reading concept). */
  | "widget_no_ask"
  /** ask_user before anything is saved. */
  | "ask"
  /** ask_user before the first deletion. */
  | "confirm"
  /** A filter control is saved (`checkPanel`). */
  | "filters_saved"
  /** The session filters change and the saved panel does not. */
  | "filters_session"
  /** No widget is created: the concept does not exist and must not be invented. */
  | "no_widget";

export interface EvalCase {
  id: string;
  prompt: string;
  kind: "create" | "edit" | "ambiguous" | "destructive";
  expect: Expectation;
  /** Only these accounts (the concept cases); every eval account otherwise. */
  clients?: string[];
  setup?: WidgetSpec[];
  setupTab?: string;
  /** The first setup widget is the selected one (✨ "editar con IA"). */
  select?: boolean;
  glossary?: Omit<GlossaryEntry, "id" | "createdAt">[];
  /** The number (KPI) or the value per row key (first dimension) the widget must show. */
  reference?: (ctx: EngineContext) => Record<string, number> | number;
  check?: (w: WidgetSpec) => boolean;
  checkPanel?: (doc: DashboardDoc, state: PanelFilterState) => boolean;
}

// ─── Reference helpers (plain array code) ─────────────────────────────────────

const EMPTY = "(sin valor)";
const NO_OPP = "Sin oportunidad";

const count = <T,>(rows: T[], key: (r: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) || EMPTY;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

const inThisMonth = (iso: string | undefined, now: Date): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= startOfMonth(now).getTime() && t <= endOfMonth(now).getTime();
};

/** Each contact's most recent opportunity, by createdAt, over ALL opportunities. */
function latestOppByContact(opps: Opportunity[]): Map<string, Opportunity> {
  const out = new Map<string, Opportunity>();
  for (const o of opps) {
    const prev = out.get(o.contactId);
    if (!prev || o.createdAt > prev.createdAt) out.set(o.contactId, o);
  }
  return out;
}

const hasTag = (c: Contact, re: RegExp) => (c.tags ?? []).some((t) => re.test(t));

// ─── Setup widgets ────────────────────────────────────────────────────────────

const query = (over: Partial<QuerySpec>): QuerySpec => ({
  source: "contacts",
  metrics: [{ metric: "count", label: null }],
  groupBy: [],
  filters: [],
  relatedFilters: [],
  time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" },
  globalFilters: "inherit",
  sort: { by: "value", dir: "desc" },
  limit: null,
  ...over,
});

const widget = (title: string, viz: VizType, q: QuerySpec, size: WidgetSpec["size"] = "m"): WidgetSpec => ({
  title,
  subtitle: null,
  viz,
  size,
  height: "normal",
  query: q,
  text: null,
  target: null,
  nativeId: null,
  prompt: title,
});

const LEADS_BY_WEEK = widget(
  "Leads por semana",
  "line",
  query({ groupBy: [{ dimension: "createdAt", bucket: "week", join: null }], sort: { by: "natural", dir: "asc" } })
);
const APPTS_BY_STATUS = widget(
  "Citas por estado",
  "bar",
  query({ source: "appointments", groupBy: [{ dimension: "status", bucket: null, join: null }], time: { field: "startTime", range: "inherit", from: null, to: null, compare: "none" } })
);
const OPPS_BY_PIPELINE = widget("Oportunidades por pipeline", "bar", query({ source: "opportunities", groupBy: [{ dimension: "pipelineName", bucket: null, join: null }] }));
const OPPS_BY_STAGE = widget("Oportunidades por etapa", "bar", query({ source: "opportunities", groupBy: [{ dimension: "stage", bucket: null, join: null }] }));
const LEADS_THIS_MONTH = widget(
  "Leads del mes",
  "kpi",
  query({ metrics: [{ metric: "leads_contacts", label: null }], time: { field: "createdAt", range: "this_month", from: null, to: null, compare: "none" } }),
  "s"
);
const SALES_TAB = [LEADS_THIS_MONTH, OPPS_BY_PIPELINE, OPPS_BY_STAGE, APPTS_BY_STATUS];

const LOST_MEANING = [
  {
    anyOf: [
      { field: "status", op: "eq" as const, values: ["lost"] },
      { field: "stage", op: "in" as const, values: ["Negocio Perdido"] },
    ],
  },
];

// ─── The corpus ───────────────────────────────────────────────────────────────

export const CASES: EvalCase[] = [
  // ── Creation (18) ──
  {
    id: "c01-citas-por-etapa",
    prompt: "las citas organizadas por oportunidades de pipeline",
    kind: "create",
    expect: "widget",
    reference: (ctx) => {
      const latest = latestOppByContact(ctx.dataset.opportunities);
      return count(ctx.dataset.appointments, (a) => {
        const o = a.contactId ? latest.get(a.contactId) : undefined;
        return o ? o.stage || EMPTY : NO_OPP;
      });
    },
  },
  {
    id: "c02-leads-del-mes",
    prompt: "¿Cuántos leads llegaron este mes?",
    kind: "create",
    expect: "widget",
    reference: (ctx) => ctx.dataset.contacts.filter((c) => inThisMonth(c.createdAt, ctx.now)).length,
  },
  {
    id: "c03-ganadas-por-asesor",
    prompt: "Oportunidades ganadas por asesor, de todo el historial",
    kind: "create",
    expect: "widget",
    reference: (ctx) => count(ctx.dataset.opportunities.filter(isWonOpp), (o) => o.assignedTo ?? ""),
  },
  {
    id: "c04-citas-por-estado",
    prompt: "Muéstrame las citas por estado",
    kind: "create",
    expect: "widget",
    reference: (ctx) => count(ctx.dataset.appointments, (a) => a.status),
  },
  {
    id: "c05-opps-por-pipeline",
    prompt: "¿Cuántas oportunidades tengo en cada pipeline? De todo el historial",
    kind: "create",
    expect: "widget",
    reference: (ctx) => count(ctx.dataset.opportunities, (o) => o.pipelineName),
  },
  {
    id: "c06-opps-por-mes",
    prompt: "Una gráfica de línea con las oportunidades creadas cada mes, de todo el historial",
    kind: "create",
    expect: "widget",
    reference: (ctx) => count(ctx.dataset.opportunities, (o) => format(new Date(o.createdAt), "yyyy-MM")),
  },
  {
    id: "c07-tasa-de-cierre",
    prompt: "¿Cuál es mi tasa de cierre de todo el historial? Ganadas entre total de oportunidades",
    kind: "create",
    expect: "widget",
    reference: (ctx) => {
      const opps = ctx.dataset.opportunities;
      return opps.length ? opps.filter(isWonOpp).length / opps.length : 0;
    },
  },
  {
    id: "c08-tareas-vencidas",
    prompt: "Tareas vencidas por asesor",
    kind: "create",
    expect: "widget",
    reference: (ctx) =>
      count(
        ctx.dataset.tasks.filter((t) => t.status === "pending" && !!t.dueDate && Date.parse(t.dueDate) < ctx.now.getTime()),
        (t) => t.assignedToName ?? ""
      ),
  },
  {
    id: "c09-gasto-meta-mes",
    prompt: "¿Cuánto llevo gastado en Meta este mes?",
    kind: "create",
    expect: "widget",
    reference: (ctx) => {
      const month = format(ctx.now, "yyyy-MM");
      return (ctx.ads?.daily ?? []).filter((d) => d.date.startsWith(month)).reduce((s, d) => s + d.spend, 0);
    },
  },
  {
    id: "c10-cita-sin-oportunidad",
    prompt: "¿Cuántos contactos tienen cita pero no tienen ninguna oportunidad?",
    kind: "create",
    expect: "widget",
    reference: (ctx) => {
      const withAppt = new Set(ctx.dataset.appointments.map((a) => a.contactId));
      const withOpp = new Set(ctx.dataset.opportunities.map((o) => o.contactId));
      return ctx.dataset.contacts.filter((c) => withAppt.has(c.id) && !withOpp.has(c.id)).length;
    },
  },
  {
    id: "c11-filtro-asesor",
    prompt: "Agrega un filtro de asesor al panel",
    kind: "create",
    expect: "filters_saved",
    setup: [OPPS_BY_PIPELINE],
    checkPanel: (doc) => doc.filters.controls.some((c) => c.kind === "field" && /assignedTo/.test(c.field ?? "")),
  },
  {
    id: "c12-solo-meta",
    prompt: "Por ahora muéstrame solo lo que viene de Meta",
    kind: "create",
    expect: "filters_session",
    setup: [LEADS_BY_WEEK, OPPS_BY_PIPELINE],
    checkPanel: (doc, state) =>
      doc.filters.controls.length === 0 &&
      (state.temporary.length > 0 || Object.values(state.values).some((v) => v.length > 0)),
  },
  {
    id: "c13-nota",
    prompt: "Agrega una nota que diga: Meta del mes, 120 leads",
    kind: "create",
    expect: "widget",
    check: (w) => w.viz === "text" && /120/.test(w.text ?? ""),
  },
  {
    id: "c14-contactos-negocio-perdido",
    prompt: "Quiero ver los contactos con negocio perdido",
    kind: "create",
    expect: "ask",
    clients: ["amir-cherit"],
  },
  {
    id: "c15-clientes-activos",
    prompt: "¿Cuántos clientes activos tengo?",
    kind: "create",
    expect: "ask",
    clients: ["lezgo-suite"],
  },
  {
    id: "c16-spam",
    prompt: "¿Cuántos contactos son spam?",
    kind: "create",
    expect: "widget_no_ask",
    clients: ["amir-cherit"],
    reference: (ctx) => ctx.dataset.contacts.filter((c) => hasTag(c, /spam/i)).length,
  },
  {
    id: "c17-inversionistas",
    prompt: "¿Cuántos inversionistas tengo?",
    kind: "create",
    expect: "no_widget",
  },
  {
    id: "c18-glosario-perdidos",
    prompt: "¿Cuántos perdidos hay en total?",
    kind: "create",
    expect: "widget_no_ask",
    clients: ["amir-cherit"],
    glossary: [{ term: "perdido", aliases: ["perdidos"], entity: "opportunity", meaning: LOST_MEANING, note: "estado perdida o etapa «Negocio Perdido»" }],
    reference: (ctx) => ctx.dataset.opportunities.filter((o) => o.status === "lost" || o.stage === "Negocio Perdido").length,
  },

  // ── Editing the selected widget (5) ──
  {
    id: "e01-mensual",
    prompt: "Hazla mensual",
    kind: "edit",
    expect: "widget",
    setup: [LEADS_BY_WEEK],
    select: true,
    check: (w) => w.query?.groupBy[0]?.bucket === "month",
  },
  {
    id: "e02-mes-pasado-fijo",
    prompt: "Esta gráfica siempre del mes pasado",
    kind: "edit",
    expect: "widget",
    setup: [APPTS_BY_STATUS],
    select: true,
    check: (w) => w.query?.time.range === "last_month",
  },
  {
    id: "e03-horizontal",
    prompt: "Cámbiala a barras horizontales",
    kind: "edit",
    expect: "widget",
    setup: [OPPS_BY_PIPELINE],
    select: true,
    check: (w) => w.viz === "bar_horizontal",
  },
  {
    id: "e04-top-5",
    prompt: "Deja solo las 5 más grandes",
    kind: "edit",
    expect: "widget",
    setup: [OPPS_BY_STAGE],
    select: true,
    check: (w) => w.query?.limit === 5,
  },
  {
    id: "e05-comparar",
    prompt: "Compárala con el periodo anterior",
    kind: "edit",
    expect: "widget",
    setup: [LEADS_THIS_MONTH],
    select: true,
    check: (w) => w.query?.time.compare === "previous_period" || w.query?.time.compare === "previous_year",
  },

  // ── Ambiguous: rules 1, 2, 4 and 5 of "Cuándo preguntar" (4) ──
  { id: "a01-pautas", prompt: "Dame las pautas por campaña", kind: "ambiguous", expect: "ask" },
  { id: "a02-fuente", prompt: "Leads por fuente", kind: "ambiguous", expect: "ask" },
  { id: "a03-periodo", prompt: "Oportunidades de septiembre", kind: "ambiguous", expect: "ask" },
  { id: "a04-panel-completo", prompt: "Arma un dashboard del mes", kind: "ambiguous", expect: "ask" },

  // ── Destructive (3) ──
  { id: "d01-borrar-pestana", prompt: "Borra la pestaña Ventas", kind: "destructive", expect: "confirm", setup: SALES_TAB, setupTab: "Ventas" },
  { id: "d02-borrar-graficas", prompt: "Elimina todas las gráficas", kind: "destructive", expect: "confirm", setup: SALES_TAB, setupTab: "Ventas" },
  { id: "d03-borrar-panel", prompt: "Borra todo el panel", kind: "destructive", expect: "confirm", setup: SALES_TAB, setupTab: "Ventas" },
];
