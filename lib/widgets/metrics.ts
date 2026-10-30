// The metric catalog of the AI panel. The model picks a MetricId; it never
// composes a formula. Every definition here is the one the hand-built dashboards
// already use (spec §6.3, "regla de paridad"), and every ratio is computed from
// its summed components — never by averaging ratios — so a folded "Otros" row or
// a re-bucketed series is recomputed from its records and stays exact.
import type { AdDay, Appointment, Opportunity } from "@/lib/types";
import type { ResolvedDateRange } from "@/lib/date-range";
import { filterByDateRange } from "@/lib/date-range";
import { contactIdsInPipelines, filterByContactIds } from "@/lib/pipeline-filter";
import { isWonOpp } from "@/lib/opportunity-status";
import { isDePauta } from "@/lib/pauta";
import { costPer, sumAdDays } from "@/lib/ads";
import type { MetricId, SourceId } from "./spec";
import {
  QueryError,
  SOURCE_DEFS,
  contactsMatchingRelated,
  matchesClause,
  type ResolvedCtx,
} from "./semantic";

type Row = Record<string, unknown>;

export interface MetricCtx extends ResolvedCtx {
  /** The widget's resolved date range (null = whole history). */
  range: ResolvedDateRange | null;
  source: SourceId;
}

export interface MetricDef {
  id: MetricId;
  label: string;
  sources: SourceId[];
  kind: "count" | "amount" | "rate";
  compute(rows: Row[], ctx: MetricCtx): number | null;
}

const CRM_SOURCES: SourceId[] = ["contacts", "opportunities", "appointments", "tasks", "pautas"];

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);
const opps = (rows: Row[]) => rows as unknown as Opportunity[];
const days = (rows: Row[]) => rows as unknown as AdDay[];

/**
 * The appointments "conversión a cita" looks at: inside the widget's range by
 * startTime and inside the active global filters — exactly the `appointments`
 * prop app/page.tsx hands the Ventas dashboard (date-filtered, then
 * pipeline-filtered through the derived contact set), plus any added global
 * control, applied the way the engine applies it (own field, or cross-object).
 */
function appointmentsInScope(ctx: MetricCtx): Appointment[] {
  let appts = filterByDateRange(ctx.dataset.appointments, (a) => a.startTime, ctx.range);
  appts = filterByContactIds(appts, (a) => a.contactId, contactIdsInPipelines(ctx.dataset.opportunities, ctx.pipelineFilter));
  for (const g of ctx.globalFilters) {
    if (g.entity === "appointment") {
      appts = appts.filter((a) => matchesClause("appointments", a as unknown as Row, g.clause, ctx));
    } else {
      const allowed = contactsMatchingRelated({ entity: g.entity, quantifier: "any", conditions: [g.clause] }, ctx);
      appts = appts.filter((a) => !!a.contactId && allowed.has(a.contactId));
    }
  }
  return appts;
}

function adsTotals(rows: Row[]) {
  return sumAdDays(days(rows));
}

export const METRICS: Record<MetricId, MetricDef> = {
  count: {
    id: "count",
    label: "Registros",
    sources: CRM_SOURCES,
    kind: "count",
    compute: (rows) => rows.length,
  },
  contacts: {
    id: "contacts",
    label: "Contactos",
    sources: CRM_SOURCES,
    kind: "count",
    compute: (rows, ctx) => {
      const def = SOURCE_DEFS[ctx.source];
      const seen = new Set<string>();
      for (const r of rows) {
        const id = def.contactIdOf(r);
        if (id) seen.add(id);
      }
      return seen.size;
    },
  },
  leads_contacts: {
    id: "leads_contacts",
    label: "Leads (contactos nuevos)",
    sources: ["contacts"],
    kind: "count",
    compute: (rows) => rows.length,
  },
  leads_pauta_opps: {
    id: "leads_pauta_opps",
    label: "Leads de pauta (oportunidades de pauta)",
    sources: ["opportunities"],
    kind: "count",
    // isDePauta over the FULL pauta history: a filtered history would make the
    // union stricter and shrink the lead count (CLAUDE.md, "the one that is easy
    // to miss").
    compute: (rows, ctx) => opps(rows).filter((o) => isDePauta(o, ctx.pautaContactsAll)).length,
  },
  leads_pauta_unique: {
    id: "leads_pauta_unique",
    label: "Leads únicos de pauta",
    sources: ["pautas"],
    kind: "count",
    compute: (rows, ctx) => rows.filter((p) => (ctx.pautaRank.get(String(p.id)) ?? 0) === 0).length,
  },
  value_sum: {
    id: "value_sum",
    label: "Valor",
    sources: ["opportunities"],
    kind: "amount",
    compute: (rows) => opps(rows).reduce((acc, o) => acc + (o.value || 0), 0),
  },
  value_avg: {
    id: "value_avg",
    label: "Valor promedio",
    sources: ["opportunities"],
    kind: "amount",
    compute: (rows) => ratio(opps(rows).reduce((acc, o) => acc + (o.value || 0), 0), rows.length),
  },
  won_count: {
    id: "won_count",
    label: "Ganadas",
    sources: ["opportunities"],
    kind: "count",
    compute: (rows) => opps(rows).filter(isWonOpp).length,
  },
  won_value: {
    id: "won_value",
    label: "Ingreso ganado",
    sources: ["opportunities"],
    kind: "amount",
    compute: (rows) => opps(rows).filter(isWonOpp).reduce((acc, o) => acc + (o.value || 0), 0),
  },
  win_rate: {
    id: "win_rate",
    label: "Conversión (ganadas ÷ total)",
    sources: ["opportunities"],
    kind: "rate",
    compute: (rows) => ratio(opps(rows).filter(isWonOpp).length, rows.length),
  },
  appointment_rate: {
    id: "appointment_rate",
    label: "Conversión a cita",
    sources: ["opportunities"],
    kind: "rate",
    compute: (rows, ctx) => {
      const withAppt = new Set(appointmentsInScope(ctx).map((a) => a.contactId));
      return ratio(opps(rows).filter((o) => withAppt.has(o.contactId)).length, rows.length);
    },
  },
  show_rate: {
    id: "show_rate",
    label: "Asistencia (asistidas ÷ citas)",
    sources: ["appointments"],
    kind: "rate",
    compute: (rows) => ratio(rows.filter((a) => a.status === "showed").length, rows.length),
  },
  overdue_tasks: {
    id: "overdue_tasks",
    label: "Tareas vencidas",
    sources: ["tasks"],
    kind: "count",
    compute: (rows, ctx) =>
      rows.filter((t) => {
        if (t.status !== "pending" || typeof t.dueDate !== "string") return false;
        const due = Date.parse(t.dueDate);
        return Number.isFinite(due) && due < ctx.now.getTime();
      }).length,
  },
  spend: {
    id: "spend",
    label: "Gasto en Meta",
    sources: ["ads_daily"],
    kind: "amount",
    compute: (rows) => adsTotals(rows).spend,
  },
  impressions: {
    id: "impressions",
    label: "Impresiones",
    sources: ["ads_daily"],
    kind: "count",
    compute: (rows) => adsTotals(rows).impressions,
  },
  clicks: {
    id: "clicks",
    label: "Clics",
    sources: ["ads_daily"],
    kind: "count",
    compute: (rows) => adsTotals(rows).clicks,
  },
  ctr: {
    id: "ctr",
    label: "CTR",
    sources: ["ads_daily"],
    kind: "rate",
    compute: (rows) => {
      const t = adsTotals(rows);
      return ratio(t.clicks, t.impressions);
    },
  },
  cpc: {
    id: "cpc",
    label: "Costo por clic",
    sources: ["ads_daily"],
    kind: "amount",
    compute: (rows) => {
      const t = adsTotals(rows);
      return costPer(t.spend, t.clicks);
    },
  },
  cpm: {
    id: "cpm",
    label: "Costo por mil impresiones",
    sources: ["ads_daily"],
    kind: "amount",
    compute: (rows) => {
      const t = adsTotals(rows);
      return t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null;
    },
  },
  cpl: {
    id: "cpl",
    label: "Costo por lead (leads = oportunidades de pauta)",
    sources: ["ads_daily"],
    kind: "amount",
    compute: () => {
      throw new QueryError("unsupported", "El costo por lead se calcula con el recorte de ventana de Meta (lib/widgets/ads-metrics.ts)");
    },
  },
};

export function metricAllowed(metric: MetricId, source: SourceId): boolean {
  return METRICS[metric].sources.includes(source);
}

