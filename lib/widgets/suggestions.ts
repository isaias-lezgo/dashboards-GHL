// The starting suggestions of an empty panel (spec §4.1). Pure and data-aware:
// a suggestion the account cannot answer — cost per lead with no Meta account
// linked, appointments by stage with no appointments — would make the first
// thing the client sees an empty chart, so each one carries the condition under
// which its answer exists.
import { isWonOpp } from "@/lib/opportunity-status"
import type { EngineContext } from "./semantic"

export interface Suggestion {
  /** The chip's text. */
  label: string
  /** What the copilot receives when the chip is clicked. */
  prompt: string
}

export const MAX_SUGGESTIONS = 6

interface Candidate extends Suggestion {
  when: (ctx: EngineContext) => boolean
}

// Priority order: the first six whose data exists. The last two are fillers so
// an account with little data still gets something to click.
const CANDIDATES: Candidate[] = [
  {
    label: "Leads por fuente este mes",
    prompt: "Muéstrame los leads de este mes agrupados por fuente",
    when: (ctx) => ctx.dataset.contacts.length > 0,
  },
  {
    label: "¿Cuánto me cuesta cada lead?",
    prompt: "¿Cuánto me cuesta cada lead de Meta? Muéstramelo por semana",
    when: (ctx) => ctx.ads?.status === "connected",
  },
  {
    label: "Citas por etapa del pipeline",
    prompt: "Muéstrame las citas organizadas por la etapa del pipeline de su oportunidad",
    when: (ctx) => ctx.dataset.appointments.length > 0,
  },
  {
    label: "Embudo de ventas",
    prompt: "Arma un embudo de ventas con las etapas de mi pipeline",
    when: (ctx) => ctx.dataset.opportunities.length > 0,
  },
  {
    label: "Ventas ganadas por asesor",
    prompt: "Muéstrame las ventas ganadas por asesor",
    // An account that never assigns owners would answer with one "(sin valor)" bar.
    when: (ctx) => ctx.dataset.opportunities.some((o) => isWonOpp(o) && !!o.assignedTo),
  },
  {
    label: "Leads de pauta por campaña",
    prompt: "Muéstrame los leads de pauta por campaña",
    when: (ctx) => ctx.dataset.pautas.length > 0,
  },
  {
    label: "Contactos nuevos por mes",
    prompt: "Muéstrame cuántos contactos nuevos llegan cada mes",
    when: (ctx) => ctx.dataset.contacts.length > 0,
  },
  {
    label: "Oportunidades por pipeline",
    prompt: "Muéstrame las oportunidades abiertas por pipeline",
    when: (ctx) => ctx.pipelines.length > 1 && ctx.dataset.opportunities.length > 0,
  },
]

export function buildSuggestions(ctx: EngineContext): Suggestion[] {
  return CANDIDATES.filter((c) => c.when(ctx))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ label, prompt }) => ({ label, prompt }))
}

/** The two starting templates (phase 1: generic prompts; phase 3: the real boards as widgets). */
export const PANEL_TEMPLATES: Suggestion[] = [
  { label: "Marketing", prompt: "Arma una pestaña de Marketing con los indicadores clave" },
  { label: "Ventas", prompt: "Arma una pestaña de Ventas con los indicadores clave" },
]
