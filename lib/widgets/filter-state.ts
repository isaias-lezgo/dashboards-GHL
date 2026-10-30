// Session state of the AI panel's global filter bar, and the pure rules around
// it (spec §6.6). The doc stores which controls exist and their DEFAULTS; what
// the user has chosen right now lives here and is not saved until they press
// "Guardar como predeterminado". Pure and client-safe.
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { DateFilter } from "@/lib/date-range";
import type { Pipeline } from "@/lib/types";
import type { FilterControl, PanelFilters, RangePreset } from "./spec";
import { listFieldValues, type ActiveGlobalFilter, type ResolvedCtx } from "./semantic";
import { resolveWidgetRange } from "./engine";
import { RANGE_LABELS, valueLabel } from "./labels";

export interface PanelFilterState {
  date: DateFilter;
  /** Selected pipeline ids; [] = todos. */
  pipelines: string[];
  /** Chosen values of `field` controls, by control id. */
  values: Record<string, string[]>;
  /** Whether each `condition` control is on, by control id. */
  on: Record<string, boolean>;
  /**
   * Session-only chips with no saved control (e.g. the AI's "muéstrame solo lo
   * de Meta"). Their selection lives in the object itself: `defaultValues` are
   * the chosen values, `defaultOn` whether a condition is on.
   */
  temporary: Omit<FilterControl, "id">[];
}

export type PanelFiltersInput = {
  defaultDate: RangePreset | null;
  defaultPipelines: string[];
  controls: Omit<FilterControl, "id">[];
};

/** A stored default date as the bar's DateFilter (the existing DateRangeFilter's presets). */
export function dateFilterFor(preset: RangePreset | null, now: Date): DateFilter {
  if (preset === null || preset === "all") return { preset: "all" };
  if (preset === "last_7d") return { preset: "week" };
  if (preset === "last_30d") return { preset: "month" };
  const range = resolveWidgetRange({ field: "createdAt", range: preset, from: null, to: null, compare: "none" }, {
    dataset: { contacts: [], opportunities: [], pautas: [], appointments: [], messages: [], tasks: [], calls: [] },
    pipelines: [],
    ads: undefined,
    dateRange: null,
    pipelineFilter: [],
    globalFilters: [],
    now,
  });
  return range ? { preset: "custom", from: range.from, to: range.to } : { preset: "all" };
}

/** The bar's DateFilter as a storable default, or null when it has no preset equivalent. */
function presetFor(date: DateFilter): RangePreset | null {
  switch (date.preset) {
    case "all":
      return "all";
    case "week":
      return "last_7d";
    case "month":
      return "last_30d";
    case "3m":
      return "last_90d";
    default:
      return null;
  }
}

export function initialFilterState(filters: PanelFilters, now: Date): PanelFilterState {
  const values: Record<string, string[]> = {};
  const on: Record<string, boolean> = {};
  for (const c of filters.controls) {
    if (c.kind === "field") values[c.id] = [...c.defaultValues];
    else on[c.id] = c.defaultOn;
  }
  return { date: dateFilterFor(filters.defaultDate, now), pipelines: [...filters.defaultPipelines], values, on, temporary: [] };
}

function toActive(c: Omit<FilterControl, "id">, values: string[], isOn: boolean): ActiveGlobalFilter | null {
  if (c.kind === "field") {
    if (!c.field || values.length === 0) return null;
    return { entity: c.entity, label: c.label, clause: { anyOf: [{ field: c.field, op: "in", values }] } };
  }
  return isOn && c.clause ? { entity: c.entity, label: c.label, clause: c.clause } : null;
}

/** What the engine filters by right now: chosen field controls, conditions that are on, temporaries. */
export function activeGlobalFilters(state: PanelFilterState, filters: PanelFilters): ActiveGlobalFilter[] {
  const out: ActiveGlobalFilter[] = [];
  for (const c of filters.controls) {
    const a = toActive(c, state.values[c.id] ?? [], state.on[c.id] ?? false);
    if (a) out.push(a);
  }
  for (const t of state.temporary) {
    const a = toActive(t, t.defaultValues, t.defaultOn);
    if (a) out.push(a);
  }
  return out;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function sameDate(a: DateFilter, b: DateFilter): boolean {
  if (a.preset !== b.preset) return false;
  if (a.preset !== "custom") return true;
  return a.from?.toDateString() === b.from?.toDateString() && a.to?.toDateString() === b.to?.toDateString();
}

export function isDefaultState(state: PanelFilterState, filters: PanelFilters, now: Date): boolean {
  const init = initialFilterState(filters, now);
  if (filters.defaultDate !== null && !sameDate(state.date, init.date)) return false;
  if (!sameSet(state.pipelines, init.pipelines)) return false;
  if (state.temporary.length > 0) return false;
  return filters.controls.every((c) =>
    c.kind === "field" ? sameSet(state.values[c.id] ?? [], init.values[c.id] ?? []) : (state.on[c.id] ?? false) === init.on[c.id]
  );
}

/** "Guardar como predeterminado": the current choices become the stored defaults; temporaries become controls. */
export function stateAsDefaults(state: PanelFilterState, filters: PanelFilters): PanelFiltersInput {
  const controls: Omit<FilterControl, "id">[] = filters.controls.map((c) => {
    const { id, ...rest } = c;
    return c.kind === "field" ? { ...rest, defaultValues: [...(state.values[id] ?? [])] } : { ...rest, defaultOn: state.on[id] ?? false };
  });
  controls.push(...state.temporary.map((t) => ({ ...t })));
  return { defaultDate: presetFor(state.date) ?? filters.defaultDate, defaultPipelines: [...state.pipelines], controls };
}

function dateLabel(date: DateFilter): string {
  switch (date.preset) {
    case "week":
      return "últimos 7 días";
    case "month":
      return "últimos 30 días";
    case "3m":
      return "últimos 3 meses";
    case "6m":
      return "últimos 6 meses";
    case "custom":
      return date.from
        ? `${format(date.from, "d MMM", { locale: es })} – ${format(date.to ?? date.from, "d MMM yyyy", { locale: es })}`
        : "todo el historial";
    default:
      return "todo el historial";
  }
}

/** The "Filtros del panel: …" line of the snapshot the model reads every turn (spec §9.1). */
export function describeFilterState(state: PanelFilterState, filters: PanelFilters, pipelines: Pipeline[]): string {
  const parts: string[] = [];
  const def = filters.defaultDate ? ` (predeterminado: ${RANGE_LABELS[filters.defaultDate]})` : "";
  parts.push(`Fecha = ${dateLabel(state.date)}${def}`);
  const names = state.pipelines.map((id) => pipelines.find((p) => p.id === id)?.name ?? id);
  parts.push(`Pipeline = ${names.length ? names.join(", ") : "todos"}`);
  const fieldText = (c: Omit<FilterControl, "id">, values: string[]) =>
    `${c.label} = ${values.length ? values.map((v) => valueLabel(c.entity, c.field ?? "", v).replace(/^«|»$/g, "")).join(", ") : "todos"}`;
  for (const c of filters.controls) {
    parts.push(c.kind === "field" ? fieldText(c, state.values[c.id] ?? []) : `${c.label}: ${state.on[c.id] ? "activo" : "apagado"}`);
  }
  for (const t of state.temporary) {
    parts.push(`${t.kind === "field" ? fieldText(t, t.defaultValues) : `${t.label}: ${t.defaultOn ? "activo" : "apagado"}`} (temporal)`);
  }
  return parts.join(" · ");
}

/**
 * Chosen values that no record has anymore (an advisor who left, a renamed
 * stage), by control id — temporaries keyed "<entity>.<field>". The bar marks
 * them "(sin datos)" instead of letting the panel empty out unexplained.
 */
export function staleValues(state: PanelFilterState, filters: PanelFilters, ctx: ResolvedCtx): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const check = (key: string, c: Omit<FilterControl, "id">, chosen: string[]) => {
    if (c.kind !== "field" || !c.field || chosen.length === 0) return;
    const present = new Set(listFieldValues(c.entity, c.field, ctx).map((v) => v.value.toLowerCase()));
    const missing = chosen.filter((v) => !present.has(v.toLowerCase()));
    if (missing.length) out[key] = missing;
  };
  for (const c of filters.controls) check(c.id, c, state.values[c.id] ?? []);
  for (const t of state.temporary) check(`${t.entity}.${t.field}`, t, t.defaultValues);
  return out;
}
