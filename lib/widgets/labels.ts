// Spanish labels for the AI panel's vocabulary. Display text only — no rule
// lives here. ENUM_LABELS_ES TRANSLATES GHL's English enum values; it never says
// what a business concept means ("perdido" can be a status, a stage, a tag… and
// that is reasoned per account by the AI, spec §6.7).
import type { EntityId, MetricId, RangePreset, SourceId, VizType } from "./spec";

export const SOURCE_LABELS: Record<SourceId, string> = {
  contacts: "Contactos",
  opportunities: "Oportunidades",
  appointments: "Citas",
  tasks: "Tareas",
  pautas: "Pautas",
  ads_daily: "Gasto de Meta",
};

export const ENTITY_NOUNS: Record<EntityId, string> = {
  contact: "contacto",
  opportunity: "oportunidad",
  appointment: "cita",
  task: "tarea",
  pauta: "pauta",
};

export const VIZ_LABELS: Record<VizType, string> = {
  kpi: "KPI",
  bar: "Barras",
  bar_horizontal: "Barras horizontales",
  stacked_bar: "Barras apiladas",
  grouped_bar: "Barras agrupadas",
  line: "Línea",
  area: "Área",
  funnel: "Embudo",
  table: "Tabla",
  record_list: "Lista",
  text: "Nota",
};

export const METRIC_PHRASES: Record<MetricId, string> = {
  count: "conteo",
  contacts: "contactos distintos",
  value_sum: "suma de valor",
  value_avg: "valor promedio",
  won_count: "ganadas",
  won_value: "valor de ganadas",
  win_rate: "conversión (ganadas ÷ total)",
  appointment_rate: "conversión a cita",
  show_rate: "asistencia (asistidas ÷ citas)",
  overdue_tasks: "tareas vencidas",
  leads_contacts: "leads = contactos nuevos",
  leads_pauta_opps: "leads = oportunidades de pauta",
  leads_pauta_unique: "leads únicos de pauta (pautas − reingresos)",
  spend: "gasto",
  impressions: "impresiones",
  clicks: "clics",
  ctr: "CTR",
  cpc: "costo por clic",
  cpm: "costo por mil impresiones",
  cpl: "costo por lead (leads = oportunidades de pauta)",
};

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: "hoy",
  last_7d: "últimos 7 días",
  last_30d: "últimos 30 días",
  last_90d: "últimos 90 días",
  this_week: "esta semana",
  this_month: "este mes",
  last_month: "mes pasado",
  this_quarter: "este trimestre",
  ytd: "en lo que va del año",
  next_7d: "próximos 7 días",
  next_30d: "próximos 30 días",
  all: "todo el historial",
};

export const FIELD_LABELS: Record<string, string> = {
  stage: "etapa",
  funnelState: "estado del embudo",
  status: "estado",
  pipelineName: "pipeline",
  pipelineId: "pipeline",
  assignedTo: "asesor",
  assignedToName: "asesor",
  source: "fuente",
  attributionMedium: "plataforma",
  platform: "plataforma",
  sourceCategory: "categoría de fuente",
  campaignResolved: "campaña",
  campaign: "campaña",
  dePauta: "de pauta",
  won: "ganada",
  lostReason: "motivo de pérdida",
  tags: "tag",
  tipo: "tipo",
  nombrePauta: "campaña",
  city: "ciudad",
  adId: "ID de anuncio",
  attributionUrl: "URL del anuncio",
  createdAt: "fecha de creación",
  closedAt: "fecha de cierre",
  updatedAt: "última actualización",
  startTime: "fecha de la cita",
  dueDate: "fecha de vencimiento",
  date: "día",
};

export function fieldLabel(field: string): string {
  const cf = /^(?:cf|customField):(.+)$/.exec(field);
  if (cf) return cf[1].trim();
  return FIELD_LABELS[field] ?? field;
}

/** Translation of GHL's enum values, keyed "<entity>.<field>". */
export const ENUM_LABELS_ES: Record<string, Record<string, string>> = {
  "opportunity.status": { open: "abierta", won: "ganada", lost: "perdida", abandoned: "abandonada" },
  "appointment.status": {
    showed: "asistió",
    noshow: "no asistió",
    confirmed: "confirmada",
    cancelled: "cancelada",
    new: "nueva",
    invalid: "inválida",
  },
  "task.status": { pending: "pendiente", completed: "completada" },
};

const BOOLEAN_FIELDS = new Set(["won", "dePauta"]);

/** A filter value as a person reads it: translated enum, sí/no, or «quoted». */
export function valueLabel(entity: EntityId | null, field: string, value: string): string {
  if (BOOLEAN_FIELDS.has(field)) return value === "true" ? "sí" : value === "false" ? "no" : value;
  const enumLabel = entity ? ENUM_LABELS_ES[`${entity}.${field}`]?.[value] : undefined;
  return enumLabel ?? `«${value}»`;
}
