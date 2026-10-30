// Pure operations on the panel document. Each returns a NEW doc — the input is
// never mutated, which is what makes optimistic updates and undo trivial — and
// throws DocOpError, with a Spanish message addressed to the model, when an id is
// unknown or a limit would be exceeded. The AI tools and the manual UI both go
// through these, so a limit is enforced in one place.
import {
  DOC_LIMITS,
  type DashboardDoc,
  type FilterControl,
  type GlossaryEntry,
  type RangePreset,
  type Tab,
  type Widget,
  type WidgetSpec,
} from "./spec";
import { normalizeTerm } from "./terms";

export type IdGen = () => string;

/** Short random id for tabs, widgets, controls and glossary entries. */
export const randomId: IdGen = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export interface OpMeta {
  now: string;
  by: "ai" | "user";
  id: IdGen;
}

export class DocOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocOpError";
  }
}

const clone = (doc: DashboardDoc): DashboardDoc => structuredClone(doc);

function tabIndex(doc: DashboardDoc, tabId: string): number {
  const i = doc.tabs.findIndex((t) => t.id === tabId);
  if (i === -1) throw new DocOpError(`La pestaña ${tabId} ya no existe; vuelve a leer el panel con get_dashboard.`);
  return i;
}

export function findWidget(doc: DashboardDoc, widgetId: string): { tab: Tab; widget: Widget } | null {
  for (const tab of doc.tabs) {
    const widget = tab.widgets.find((w) => w.id === widgetId);
    if (widget) return { tab, widget };
  }
  return null;
}

function requireWidget(doc: DashboardDoc, widgetId: string): { tab: Tab; widget: Widget } {
  const hit = findWidget(doc, widgetId);
  if (!hit) throw new DocOpError(`El widget ${widgetId} ya no existe; vuelve a leer el panel con get_dashboard.`);
  return hit;
}

function assertTabRoom(tab: Tab, adding: number): void {
  if (tab.widgets.length + adding > DOC_LIMITS.maxWidgetsPerTab) {
    throw new DocOpError(
      `La pestaña «${tab.title}» llegaría a ${tab.widgets.length + adding} widgets; el máximo es ${DOC_LIMITS.maxWidgetsPerTab}. Usa otra pestaña o borra algunos.`
    );
  }
}

function newTab(doc: DashboardDoc, title: string, id: IdGen): Tab {
  if (doc.tabs.length >= DOC_LIMITS.maxTabs) {
    throw new DocOpError(`El panel ya tiene ${DOC_LIMITS.maxTabs} pestañas, el máximo. Borra o reutiliza una.`);
  }
  return { id: id(), title: title.trim().slice(0, DOC_LIMITS.maxTitle), widgets: [] };
}

export function addWidgets(
  doc: DashboardDoc,
  args: { tabId: string | null; newTabTitle: string | null; widgets: WidgetSpec[]; position: "start" | "end" },
  meta: OpMeta
): { doc: DashboardDoc; tabId: string; widgetIds: string[] } {
  if ((args.tabId === null) === (args.newTabTitle === null)) {
    throw new DocOpError("Indica exactamente uno: tabId (pestaña existente) o newTabTitle (pestaña nueva).");
  }
  if (args.widgets.length === 0) throw new DocOpError("No hay widgets que crear.");
  const next = clone(doc);
  let tab: Tab;
  if (args.tabId !== null) {
    tab = next.tabs[tabIndex(next, args.tabId)];
  } else {
    tab = newTab(next, args.newTabTitle!, meta.id);
    next.tabs.push(tab);
  }
  assertTabRoom(tab, args.widgets.length);
  const created: Widget[] = args.widgets.map((spec) => ({
    ...structuredClone(spec),
    id: meta.id(),
    createdAt: meta.now,
    createdBy: meta.by,
    updatedAt: meta.now,
  }));
  tab.widgets = args.position === "start" ? [...created, ...tab.widgets] : [...tab.widgets, ...created];
  return { doc: next, tabId: tab.id, widgetIds: created.map((w) => w.id) };
}

export function updateWidget(doc: DashboardDoc, widgetId: string, spec: WidgetSpec, meta: OpMeta): DashboardDoc {
  requireWidget(doc, widgetId);
  const next = clone(doc);
  for (const tab of next.tabs) {
    const i = tab.widgets.findIndex((w) => w.id === widgetId);
    if (i === -1) continue;
    const prev = tab.widgets[i];
    tab.widgets[i] = { ...structuredClone(spec), id: prev.id, createdAt: prev.createdAt, createdBy: prev.createdBy, updatedAt: meta.now };
  }
  return next;
}

export function deleteWidgets(doc: DashboardDoc, widgetIds: string[]): DashboardDoc {
  for (const id of widgetIds) requireWidget(doc, id);
  const drop = new Set(widgetIds);
  const next = clone(doc);
  for (const tab of next.tabs) tab.widgets = tab.widgets.filter((w) => !drop.has(w.id));
  return next;
}

export function moveWidgets(doc: DashboardDoc, widgetIds: string[], toTabId: string): DashboardDoc {
  const target = tabIndex(doc, toTabId);
  const moving = widgetIds.map((id) => requireWidget(doc, id).widget);
  const next = clone(doc);
  const drop = new Set(widgetIds);
  for (const tab of next.tabs) tab.widgets = tab.widgets.filter((w) => !drop.has(w.id));
  assertTabRoom(next.tabs[target], moving.length);
  next.tabs[target].widgets.push(...moving.map((w) => structuredClone(w)));
  return next;
}

export function arrangeTab(
  doc: DashboardDoc,
  tabId: string,
  items: { widgetId: string; size: WidgetSpec["size"]; height: WidgetSpec["height"] }[]
): DashboardDoc {
  const ti = tabIndex(doc, tabId);
  const tab = doc.tabs[ti];
  const have = new Set(tab.widgets.map((w) => w.id));
  const given = new Set(items.map((i) => i.widgetId));
  const missing = [...have].filter((id) => !given.has(id));
  const extra = [...given].filter((id) => !have.has(id));
  if (missing.length || extra.length || given.size !== items.length) {
    throw new DocOpError(
      `arrange_tab necesita exactamente los ${have.size} widgets de «${tab.title}», cada uno una vez` +
        (missing.length ? `; faltan: ${missing.join(", ")}` : "") +
        (extra.length ? `; no son de esta pestaña: ${extra.join(", ")}` : "") +
        "."
    );
  }
  const next = clone(doc);
  const byId = new Map(next.tabs[ti].widgets.map((w) => [w.id, w]));
  next.tabs[ti].widgets = items.map((i) => ({ ...byId.get(i.widgetId)!, size: i.size, height: i.height }));
  return next;
}

export function upsertTab(
  doc: DashboardDoc,
  args: { tabId: string | null; title: string; position: number | null },
  id: IdGen
): { doc: DashboardDoc; tabId: string } {
  if (!args.title.trim()) throw new DocOpError("La pestaña necesita un título.");
  const next = clone(doc);
  let tab: Tab;
  if (args.tabId !== null) {
    const i = tabIndex(next, args.tabId);
    tab = next.tabs[i];
    tab.title = args.title.trim().slice(0, DOC_LIMITS.maxTitle);
    next.tabs.splice(i, 1);
  } else {
    tab = newTab(next, args.title, id);
  }
  const at = args.position === null ? next.tabs.length : Math.max(0, Math.min(args.position, next.tabs.length));
  next.tabs.splice(at, 0, tab);
  return { doc: next, tabId: tab.id };
}

export function deleteTab(doc: DashboardDoc, tabId: string): DashboardDoc {
  const i = tabIndex(doc, tabId);
  const next = clone(doc);
  next.tabs.splice(i, 1);
  return next;
}

// ─── Global filters ───────────────────────────────────────────────────────────

const controlKey = (c: Pick<FilterControl, "kind" | "entity" | "field" | "label">): string =>
  c.kind === "field" ? `field:${c.entity}.${c.field}` : `condition:${c.entity}.${c.label.trim().toLowerCase()}`;

export function setPanelFilters(
  doc: DashboardDoc,
  filters: { defaultDate: RangePreset | null; defaultPipelines: string[]; controls: Omit<FilterControl, "id">[] },
  id: IdGen
): DashboardDoc {
  if (filters.controls.length > DOC_LIMITS.maxControls) {
    throw new DocOpError(`La barra admite hasta ${DOC_LIMITS.maxControls} filtros agregados; pediste ${filters.controls.length}.`);
  }
  const seen = new Set<string>();
  for (const c of filters.controls) {
    if (c.kind === "field" && !c.field) throw new DocOpError(`El filtro «${c.label}» es de campo pero no dice qué campo.`);
    if (c.kind === "condition" && !c.clause) throw new DocOpError(`El filtro «${c.label}» es una condición pero no trae la condición.`);
    const key = controlKey(c);
    if (seen.has(key)) throw new DocOpError(`El filtro «${c.label}» está repetido.`);
    seen.add(key);
  }
  const existing = new Map(doc.filters.controls.map((c) => [controlKey(c), c.id]));
  const next = clone(doc);
  next.filters = {
    defaultDate: filters.defaultDate,
    defaultPipelines: [...filters.defaultPipelines],
    controls: filters.controls.map((c) => ({ ...structuredClone(c), id: existing.get(controlKey(c)) ?? id() })),
  };
  return next;
}

// ─── Glossary ─────────────────────────────────────────────────────────────────

function entryMatches(entry: GlossaryEntry, words: Set<string>): boolean {
  return [entry.term, ...entry.aliases].some((w) => words.has(normalizeTerm(w)));
}

export function saveTerm(doc: DashboardDoc, entry: Omit<GlossaryEntry, "id" | "createdAt">, meta: OpMeta): DashboardDoc {
  const words = new Set([entry.term, ...entry.aliases].map(normalizeTerm));
  const next = clone(doc);
  const i = next.glossary.findIndex((g) => entryMatches(g, words));
  if (i !== -1) {
    next.glossary[i] = { ...structuredClone(entry), id: next.glossary[i].id, createdAt: next.glossary[i].createdAt };
    return next;
  }
  if (next.glossary.length >= DOC_LIMITS.maxGlossary) {
    throw new DocOpError(`El glosario ya tiene ${DOC_LIMITS.maxGlossary} términos, el máximo. Borra alguno con forget_term.`);
  }
  next.glossary.push({ ...structuredClone(entry), id: meta.id(), createdAt: meta.now });
  return next;
}

export function forgetTerm(doc: DashboardDoc, term: string): DashboardDoc {
  const words = new Set([normalizeTerm(term)]);
  const i = doc.glossary.findIndex((g) => entryMatches(g, words));
  if (i === -1) throw new DocOpError(`«${term}» no está en el glosario.`);
  const next = clone(doc);
  next.glossary.splice(i, 1);
  return next;
}
