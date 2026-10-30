// The copilot's panel tools (spec §8.1) and their executor. They run in the
// browser, like the assistant's tools: the server returns tool_use blocks and
// the agent loop calls executePanelTool. Every write goes through doc-ops via
// the doc hook's commit, after the same validation the manual UI uses, so the
// model can never save a widget the engine cannot compute.
//
// Strict tool use: the API caps strict schemas at 16 union-typed parameters per
// REQUEST (anyOf / type arrays, nullable included) and 20 strict tools. The
// widget spec alone has 11 nullable fields and three tools carry it, so those
// three are NOT strict — zod + validateWidget check them before any commit and
// send the issues back as an is_error result. The rest are strict and add up to
// 12 unions; scripts/verify-widgets.ts keeps that count under the cap.
import type Anthropic from "@anthropic-ai/sdk";
import { parseISO } from "date-fns";
import { TOOL_DEFINITIONS } from "@/lib/ai-tools";
import type { DateFilter } from "@/lib/date-range";
import type { CommitResult, DashboardDocApi } from "@/hooks/use-dashboard-doc";
import {
  ENTITIES,
  FILTER_CLAUSE_JSON_SCHEMA,
  HEIGHTS,
  RANGE_PRESETS,
  SIZES,
  WIDGET_SPEC_JSON_SCHEMA,
  arr,
  enumOf,
  nullable,
  obj,
  str,
  widgetSpecSchema,
  type DashboardDoc,
  type EntityId,
  type FilterClause,
  type FilterControl,
  type PanelFilters,
  type RangePreset,
  type Widget,
  type WidgetSpec,
} from "./spec";
import {
  addWidgets,
  arrangeTab,
  deleteTab,
  deleteWidgets,
  findWidget,
  forgetTerm,
  moveWidgets,
  saveTerm,
  setPanelFilters,
  updateWidget,
  upsertTab,
  type OpMeta,
} from "./doc-ops";
import { runQuery } from "./engine";
import { describeWidget } from "./describe";
import { ENTITY_FIELDS, listFieldValues, resolveCtx, type EngineContext } from "./semantic";
import { buildCatalog, suggestField, validateEntityClauses, validateEntityField, validateWidget, type Catalog, type ValidationIssue } from "./validate";
import { dateFilterFor, describeFilterState, initialFilterState, type PanelFilterState } from "./filter-state";
import { fieldLabel } from "./labels";

// ─── Definitions ──────────────────────────────────────────────────────────────

const ID = (what: string) => str(`Id of the ${what}, as shown in brackets in the panel snapshot or returned by a tool. Never print it to the user.`);

const CONTROL_SCHEMA = obj({
  kind: enumOf(["field", "condition"], "'field' = a chip that picks values of one field; 'condition' = an on/off chip for a named condition (e.g. 'Perdidos')."),
  entity: enumOf(ENTITIES, "Object the control filters."),
  label: nullable(str("Chip label in Spanish. null for a field control = the field's own name. Required for a condition.")),
  field: nullable(str("Field of `entity` for kind 'field' (native, derived or 'cf:<Name>'). null for a condition.")),
  defaultValues: arr(str(), "Default chosen values of a field control; [] = todos."),
  clause: nullable(FILTER_CLAUSE_JSON_SCHEMA),
  defaultOn: { type: "boolean", description: "Whether a condition starts on. false for field controls." },
});

export const PANEL_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "get_dashboard",
    description:
      "Reads the panel: tabs, the widgets of one tab (title, size, the rule they compute in words, and their full spec to edit), the selected widget, the active filters, the saved filter controls with the values available for each, and the client's glossary. Call it when the snapshot in the user message is not enough or after a conflict error.",
    strict: true,
    input_schema: obj({ tabId: nullable(str("Tab to read. null = the active tab.")) }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "preview_widget",
    description:
      "Runs a widget spec WITHOUT saving it and returns what it would show: the rule in words (`scope`), the first 15 rows, totals, record count and the engine's warnings — or the validation issues with suggested fixes. Call it before create_widgets/update_widget when the field, join or date base is not obvious, and read the warnings before saving.",
    input_schema: obj({ widget: WIDGET_SPEC_JSON_SCHEMA }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "create_widgets",
    description:
      "Creates 1 to 12 widgets in ONE call, in an existing tab (`tabId`) or a new one (`newTabTitle`) — exactly one of the two. All or nothing: any invalid widget rejects the call with its issues. The target tab becomes the active one. Build several widgets of one request in a single call, never one call per widget.",
    input_schema: obj({
      tabId: nullable(ID("existing tab")),
      newTabTitle: nullable(str("Title of a new tab, in Spanish.")),
      widgets: arr(WIDGET_SPEC_JSON_SCHEMA, "1 to 12 widget specs."),
      position: enumOf(["start", "end"], "Where in the tab the new widgets go."),
    }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "update_widget",
    description:
      "REPLACES a widget's whole spec (no partial patches): send the full spec from get_dashboard with your change applied. The widget's original `prompt` is kept.",
    input_schema: obj({ widgetId: ID("widget"), widget: WIDGET_SPEC_JSON_SCHEMA }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "delete_widgets",
    description: "Deletes widgets. Confirm with ask_user first when deleting more than 3.",
    strict: true,
    input_schema: obj({ widgetIds: arr(ID("widget")) }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "move_widgets",
    description: "Moves widgets to another tab (appended at its end).",
    strict: true,
    input_schema: obj({ widgetIds: arr(ID("widget")), toTabId: ID("destination tab") }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "arrange_tab",
    description:
      "Sets the order and size of a tab's widgets. `items` must list EVERY widget of the tab exactly once, in the new order. Sizes are widths on 12 columns: s=3, m=6, l=8, xl=12.",
    strict: true,
    input_schema: obj({
      tabId: ID("tab"),
      items: arr(obj({ widgetId: ID("widget"), size: enumOf(SIZES), height: enumOf(HEIGHTS) })),
    }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "upsert_tab",
    description: "Creates a tab (tabId null) or renames/moves an existing one. A new tab becomes the active one.",
    strict: true,
    input_schema: obj({
      tabId: nullable(ID("tab to rename")),
      title: str("Tab title in Spanish."),
      position: nullable({ type: "integer", description: "0-based position among the tabs. null = last (new) or unchanged order (rename)." }),
    }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "delete_tab",
    description: "Deletes a tab and its widgets. If it has widgets, confirm with ask_user first.",
    strict: true,
    input_schema: obj({ tabId: ID("tab") }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "get_widget_data",
    description:
      "What a SAVED widget shows right now with the active filters: rows, totals, record count, warnings. Use it to explain a number or an anomaly the user asks about.",
    strict: true,
    input_schema: obj({
      widgetId: ID("widget"),
      limit: nullable({ type: "integer", description: "Rows to return (default 15, max 50)." }),
    }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "set_panel_filters",
    description:
      "SAVES the panel's global filters: the default date, the default pipelines (by NAME) and the added controls. Replaces the whole list — send the existing controls too (get_dashboard) when adding one. Use it when the user wants a filter to stay ('agrega un filtro de asesor', 'que siempre…'). The saved defaults are applied to the current view.",
    strict: true,
    input_schema: obj({
      defaultDate: nullable(enumOf(RANGE_PRESETS, "Default date range. null = keep the bar's own default.")),
      defaultPipelines: arr(str(), "Pipeline NAMES selected by default; [] = todos."),
      controls: arr(CONTROL_SCHEMA, "Up to 8 controls."),
    }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "apply_filters",
    description:
      "Changes what the user sees NOW, for this session only — nothing is saved: date, pipelines (by name), values of field controls, and conditions. A value or condition with no saved control appears as a temporary chip the user can pin. Use it for 'por ahora', 'muéstrame solo…'.",
    strict: true,
    input_schema: obj({
      date: nullable(
        obj({
          range: enumOf(["absolute", ...RANGE_PRESETS]),
          from: nullable(str("YYYY-MM-DD, only with 'absolute'.")),
          to: nullable(str("YYYY-MM-DD, only with 'absolute'. null = today.")),
        })
      ),
      pipelines: nullable(arr(str(), "Pipeline NAMES; [] = todos. null = leave as is.")),
      values: arr(
        obj({ entity: enumOf(ENTITIES), field: str("Field of the object, e.g. 'assignedTo', 'source', 'cf:<Name>'."), values: arr(str(), "[] = todos.") }),
        "Field filters; OR within values."
      ),
      conditions: arr(obj({ entity: enumOf(ENTITIES), label: str("Chip label in Spanish."), clause: FILTER_CLAUSE_JSON_SCHEMA }), "Named conditions to turn on."),
    }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "save_term",
    description:
      "Saves (or redefines) the client's meaning of a business concept in the glossary, after the user chose it: e.g. 'perdido' = status lost OR stage 'Negocio Perdido'. `meaning` holds the clauses as resolve_term returned them. Later conversations read it from the snapshot and do not ask again.",
    strict: true,
    input_schema: obj({
      term: str("The concept as the user says it, singular, e.g. 'perdido'."),
      aliases: arr(str(), "Other words for the same concept, e.g. ['perdidos', 'negocio perdido']."),
      entity: enumOf(ENTITIES, "Object the meaning filters."),
      meaning: arr(FILTER_CLAUSE_JSON_SCHEMA, "1 to 5 clauses, AND'ed."),
      note: str("The meaning in plain Spanish, with this account's real names, e.g. 'estado perdida o etapa «Negocio Perdido»'."),
    }) as Anthropic.Tool.InputSchema,
  },
  {
    name: "forget_term",
    description: "Deletes a concept from the client's glossary.",
    strict: true,
    input_schema: obj({ term: str() }) as Anthropic.Tool.InputSchema,
  },
];

/** The assistant's tools the panel does not use: ephemeral chat charts, chat PDFs, uploads. */
const ASSISTANT_ONLY = new Set(["render_chart", "show_in_panel", "create_pdf", "list_uploaded_files", "query_uploaded_table", "join_uploaded_table"]);

/** Panel mode's tool list. Fixed order: it is part of the cached prefix. */
export const PANEL_MODE_TOOLS: Anthropic.Tool[] = [
  ...(TOOL_DEFINITIONS as unknown as Anthropic.Tool[]).filter((t) => !ASSISTANT_ONLY.has(t.name)),
  ...PANEL_TOOL_DEFINITIONS,
];

const PANEL_TOOL_NAMES = new Set(PANEL_TOOL_DEFINITIONS.map((t) => t.name));

export function isPanelTool(name: string): boolean {
  return PANEL_TOOL_NAMES.has(name);
}

// ─── Executor ─────────────────────────────────────────────────────────────────

export interface PanelToolDeps {
  getDoc(): DashboardDoc;
  commit: DashboardDocApi["commit"];
  engineCtx(): EngineContext;
  activeTabId(): string | null;
  selectedWidgetId(): string | null;
  setActiveTab(id: string): void;
  getFilterState(): PanelFilterState;
  applyFilterState(next: PanelFilterState): void;
  now(): string;
  newId(): string;
}

type ToolOut = Record<string, unknown>;

const CONFLICT_ERROR = "El panel cambió en otra sesión; vuelve a leerlo con get_dashboard.";
const PREVIEW_ROWS = 15;
const MAX_WIDGETS_PER_CALL = 12;

const opMeta = (deps: PanelToolDeps): OpMeta => ({ now: deps.now(), by: "ai", id: deps.newId });

function outcome(res: CommitResult): ToolOut {
  if (res.ok) return { ok: true, version: res.version };
  return { error: res.reason === "conflict" ? CONFLICT_ERROR : res.message };
}

const invalid = (issues: ValidationIssue[], what = "La especificación no es válida") => ({
  error: `${what}: corrige lo que dicen los issues y vuelve a intentar.`,
  issues,
});

function checkSpec(raw: unknown, catalog: Catalog, path: string): { spec: WidgetSpec } | { issues: ValidationIssue[] } {
  const parsed = widgetSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((i) => ({ path: [path, ...i.path].join("."), message: i.message, suggestion: null })),
    };
  }
  const issues = validateWidget(parsed.data, catalog).map((i) => ({ ...i, path: `${path}.${i.path}` }));
  return issues.length ? { issues } : { spec: parsed.data };
}

function specOf(w: Widget): WidgetSpec {
  const { id: _id, createdAt: _c, createdBy: _b, updatedAt: _u, ...spec } = w;
  return spec;
}

function summarize(spec: WidgetSpec, ctx: EngineContext, limit: number): ToolOut {
  const scope = describeWidget(spec);
  if (!spec.query) return { scope, rows: [], totalRows: 0, totals: [], recordCount: 0, warnings: [], adsStatus: null };
  try {
    const r = runQuery(spec.query, ctx);
    return {
      scope,
      metrics: spec.query.metrics.map((m) => m.metric),
      rows: r.rows.slice(0, limit).map((row) => ({ label: row.label.join(" · "), values: row.values })),
      totalRows: r.rows.length,
      totals: r.totals,
      recordCount: r.meta.recordCount,
      warnings: r.meta.warnings,
      adsStatus: r.meta.adsStatus,
      ...(r.meta.adsMessage ? { adsMessage: r.meta.adsMessage } : {}),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A field chip's label: the object's own name for it, else the field's readable name. */
function controlLabel(entity: EntityId, field: string): string {
  return ENTITY_FIELDS[entity].find((f) => f.field === field)?.label ?? capitalize(fieldLabel(field));
}

/** Pipeline names → ids. The model speaks names; the bar stores ids. */
function pipelineIds(names: string[], ctx: EngineContext): { ids: string[] } | { error: string } {
  const ids: string[] = [];
  for (const name of names) {
    const hit = ctx.pipelines.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!hit) {
      const all = ctx.pipelines.map((p) => p.name);
      const guess = suggestField(name, all);
      return {
        error: `El pipeline «${name}» no existe${guess ? `; ¿quisiste «${guess}»?` : "."} Pipelines de esta cuenta: ${all.join(", ") || "ninguno"}.`,
      };
    }
    ids.push(hit.id);
  }
  return { ids };
}

function absoluteDate(from: string | null, to: string | null, now: Date): DateFilter | null {
  if (!from) return null;
  const f = parseISO(from);
  const t = to ? parseISO(to) : now;
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f > t) return null;
  return { preset: "custom", from: f, to: t };
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export async function executePanelTool(name: string, input: Record<string, unknown>, deps: PanelToolDeps): Promise<unknown> {
  switch (name) {
    case "get_dashboard": {
      const doc = deps.getDoc();
      const ctx = deps.engineCtx();
      const wanted = asString(input.tabId);
      const tabId = wanted ?? deps.activeTabId();
      const tab = doc.tabs.find((t) => t.id === tabId) ?? null;
      if (wanted && !tab) return { error: `La pestaña ${wanted} ya no existe.` };
      const state = deps.getFilterState();
      const r = resolveCtx(ctx);
      return {
        tabs: doc.tabs.map((t) => ({ id: t.id, title: t.title, widgets: t.widgets.length })),
        activeTabId: deps.activeTabId(),
        tab: tab && {
          id: tab.id,
          title: tab.title,
          widgets: tab.widgets.map((w) => ({ id: w.id, title: w.title, viz: w.viz, size: w.size, height: w.height, scope: describeWidget(w), spec: specOf(w) })),
        },
        selectedWidgetId: deps.selectedWidgetId(),
        filters: describeFilterState(state, doc.filters, ctx.pipelines),
        defaults: {
          date: doc.filters.defaultDate,
          pipelines: doc.filters.defaultPipelines.map((id) => ctx.pipelines.find((p) => p.id === id)?.name ?? id),
        },
        controls: doc.filters.controls.map((c) => ({
          id: c.id,
          kind: c.kind,
          entity: c.entity,
          label: c.label,
          field: c.field,
          clause: c.clause,
          ...(c.kind === "field" ? { chosen: state.values[c.id] ?? [] } : { on: state.on[c.id] ?? false }),
          available: c.kind === "field" && c.field ? listFieldValues(c.entity, c.field, r).slice(0, 20) : [],
        })),
        glossary: doc.glossary.map(({ term, aliases, entity, meaning, note }) => ({ term, aliases, entity, meaning, note })),
      };
    }

    case "preview_widget": {
      const ctx = deps.engineCtx();
      const checked = checkSpec(input.widget, buildCatalog(ctx), "widget");
      if ("issues" in checked) return invalid(checked.issues);
      return summarize(checked.spec, ctx, PREVIEW_ROWS);
    }

    case "create_widgets": {
      const raw = asArray<unknown>(input.widgets);
      if (raw.length === 0 || raw.length > MAX_WIDGETS_PER_CALL) {
        return { error: `create_widgets recibe de 1 a ${MAX_WIDGETS_PER_CALL} widgets; llegaron ${raw.length}.` };
      }
      const catalog = buildCatalog(deps.engineCtx());
      const specs: WidgetSpec[] = [];
      const issues: ValidationIssue[] = [];
      raw.forEach((w, i) => {
        const checked = checkSpec(w, catalog, `widgets[${i}]`);
        if ("issues" in checked) issues.push(...checked.issues);
        else specs.push(checked.spec);
      });
      if (issues.length) return invalid(issues, "Ningún widget se creó");
      const tabId = asString(input.tabId);
      const newTabTitle = asString(input.newTabTitle);
      const where = newTabTitle ?? deps.getDoc().tabs.find((t) => t.id === tabId)?.title ?? "";
      let created: { tabId: string; widgetIds: string[] } | null = null;
      const res = await deps.commit(
        (d) => {
          const r = addWidgets(d, { tabId, newTabTitle, widgets: specs, position: input.position === "start" ? "start" : "end" }, opMeta(deps));
          created = { tabId: r.tabId, widgetIds: r.widgetIds };
          return r.doc;
        },
        `${specs.length === 1 ? `Creó «${specs[0].title}»` : `Creó ${specs.length} widgets`}${where ? ` en «${where}»` : ""}`,
        "ai"
      );
      const out = outcome(res);
      if (!res.ok || !created) return out;
      const done: { tabId: string; widgetIds: string[] } = created;
      deps.setActiveTab(done.tabId);
      return { ...out, tabId: done.tabId, widgetIds: done.widgetIds };
    }

    case "update_widget": {
      const widgetId = asString(input.widgetId) ?? "";
      const checked = checkSpec(input.widget, buildCatalog(deps.engineCtx()), "widget");
      if ("issues" in checked) return invalid(checked.issues, "El widget no cambió");
      const spec = checked.spec;
      return outcome(
        await deps.commit(
          (d) => {
            // The prompt records what the widget was created for; an edit keeps it.
            const prev = findWidget(d, widgetId)?.widget;
            return updateWidget(d, widgetId, prev ? { ...spec, prompt: prev.prompt } : spec, opMeta(deps));
          },
          `Editó «${spec.title}»`,
          "ai"
        )
      );
    }

    case "delete_widgets": {
      const ids = asArray<string>(input.widgetIds);
      if (ids.length === 0) return { error: "No hay widgets que borrar." };
      const titles = ids.map((id) => findWidget(deps.getDoc(), id)?.widget.title).filter(Boolean);
      return outcome(
        await deps.commit((d) => deleteWidgets(d, ids), titles.length === 1 ? `Borró «${titles[0]}»` : `Borró ${ids.length} widgets`, "ai")
      );
    }

    case "move_widgets": {
      const ids = asArray<string>(input.widgetIds);
      const to = asString(input.toTabId) ?? "";
      return outcome(await deps.commit((d) => moveWidgets(d, ids, to), `Movió ${ids.length} widget(s)`, "ai"));
    }

    case "arrange_tab": {
      const tabId = asString(input.tabId) ?? "";
      const items = asArray<{ widgetId: string; size: WidgetSpec["size"]; height: WidgetSpec["height"] }>(input.items);
      return outcome(await deps.commit((d) => arrangeTab(d, tabId, items), "Reacomodó la pestaña", "ai"));
    }

    case "upsert_tab": {
      const tabId = asString(input.tabId);
      const title = typeof input.title === "string" ? input.title : "";
      const position = typeof input.position === "number" ? input.position : null;
      let saved: string | null = null;
      const res = await deps.commit(
        (d) => {
          const r = upsertTab(d, { tabId, title, position }, deps.newId);
          saved = r.tabId;
          return r.doc;
        },
        tabId ? `Renombró la pestaña a «${title}»` : `Creó la pestaña «${title}»`,
        "ai"
      );
      const out = outcome(res);
      if (!res.ok || !saved) return out;
      if (!tabId) deps.setActiveTab(saved);
      return { ...out, tabId: saved };
    }

    case "delete_tab": {
      const tabId = asString(input.tabId) ?? "";
      const title = deps.getDoc().tabs.find((t) => t.id === tabId)?.title;
      return outcome(await deps.commit((d) => deleteTab(d, tabId), `Borró la pestaña «${title ?? tabId}»`, "ai"));
    }

    case "get_widget_data": {
      const widgetId = asString(input.widgetId) ?? "";
      const hit = findWidget(deps.getDoc(), widgetId);
      if (!hit) return { error: `El widget ${widgetId} ya no existe; vuelve a leer el panel con get_dashboard.` };
      const limit = typeof input.limit === "number" ? Math.max(1, Math.min(50, Math.floor(input.limit))) : PREVIEW_ROWS;
      return summarize(hit.widget, deps.engineCtx(), limit);
    }

    case "set_panel_filters": {
      const ctx = deps.engineCtx();
      const catalog = buildCatalog(ctx);
      const pipes = pipelineIds(asArray<string>(input.defaultPipelines), ctx);
      if ("error" in pipes) return pipes;
      const issues: ValidationIssue[] = [];
      const controls: Omit<FilterControl, "id">[] = [];
      asArray<Omit<FilterControl, "id" | "label"> & { label: string | null }>(input.controls).forEach((c, i) => {
        const path = `controls[${i}]`;
        if (c.kind === "field") {
          if (!c.field) return issues.push({ path: `${path}.field`, message: "Un control de campo necesita `field`.", suggestion: null });
          const issue = validateEntityField(c.entity, c.field, catalog, `${path}.field`);
          if (issue) return issues.push(issue);
          controls.push({ ...c, label: c.label?.trim() || controlLabel(c.entity, c.field), clause: null, defaultOn: false });
        } else {
          if (!c.clause) return issues.push({ path: `${path}.clause`, message: "Una condición necesita `clause`.", suggestion: null });
          if (!c.label?.trim()) return issues.push({ path: `${path}.label`, message: "Una condición necesita una etiqueta («Perdidos»).", suggestion: null });
          issues.push(...validateEntityClauses(c.entity, [c.clause], catalog, `${path}.clause`));
          controls.push({ ...c, label: c.label.trim(), field: null, defaultValues: [] });
        }
      });
      if (issues.length) return invalid(issues, "Los filtros no se guardaron");
      const defaultDate = (RANGE_PRESETS as readonly string[]).includes(input.defaultDate as string) ? (input.defaultDate as RangePreset) : null;
      let saved: PanelFilters | null = null;
      const res = await deps.commit(
        (d) => {
          const next = setPanelFilters(d, { defaultDate, defaultPipelines: pipes.ids, controls }, deps.newId);
          saved = next.filters;
          return next;
        },
        "Cambió los filtros del panel",
        "ai"
      );
      const out = outcome(res);
      if (!res.ok || !saved) return out;
      // The user asked for these defaults: show them now. Temporaries that a
      // saved control now covers are dropped; the rest stay.
      const filters: PanelFilters = saved;
      const prev = deps.getFilterState();
      const init = initialFilterState(filters, ctx.now);
      const covered = (t: Omit<FilterControl, "id">) =>
        filters.controls.some((c) => c.kind === t.kind && c.entity === t.entity && (t.kind === "field" ? c.field === t.field : c.label === t.label));
      const next: PanelFilterState = {
        ...init,
        date: defaultDate === null ? prev.date : init.date,
        temporary: prev.temporary.filter((t) => !covered(t)),
      };
      deps.applyFilterState(next);
      return { ...out, filters: describeFilterState(next, filters, ctx.pipelines) };
    }

    case "apply_filters": {
      const ctx = deps.engineCtx();
      const doc = deps.getDoc();
      const catalog = buildCatalog(ctx);
      const prev = deps.getFilterState();
      const next: PanelFilterState = { ...prev, values: { ...prev.values }, on: { ...prev.on }, temporary: [...prev.temporary] };
      const issues: ValidationIssue[] = [];

      const date = input.date as { range: string; from: string | null; to: string | null } | null | undefined;
      if (date) {
        if (date.range === "absolute") {
          const d = absoluteDate(date.from, date.to, ctx.now);
          if (!d) return { error: "Un periodo absoluto necesita `from` (YYYY-MM-DD) y, si va, un `to` posterior." };
          next.date = d;
        } else if ((RANGE_PRESETS as readonly string[]).includes(date.range)) {
          next.date = dateFilterFor(date.range as RangePreset, ctx.now);
        }
      }
      if (Array.isArray(input.pipelines)) {
        const pipes = pipelineIds(input.pipelines as string[], ctx);
        if ("error" in pipes) return pipes;
        next.pipelines = pipes.ids;
      }

      asArray<{ entity: EntityId; field: string; values: string[] }>(input.values).forEach((v, i) => {
        const issue = validateEntityField(v.entity, v.field, catalog, `values[${i}].field`);
        if (issue) return issues.push(issue);
        const control = doc.filters.controls.find((c) => c.kind === "field" && c.entity === v.entity && c.field === v.field);
        if (control) {
          next.values[control.id] = [...v.values];
          return;
        }
        next.temporary = next.temporary.filter((t) => !(t.kind === "field" && t.entity === v.entity && t.field === v.field));
        if (v.values.length) {
          next.temporary.push({ kind: "field", entity: v.entity, label: controlLabel(v.entity, v.field), field: v.field, defaultValues: [...v.values], clause: null, defaultOn: false });
        }
      });

      asArray<{ entity: EntityId; label: string; clause: FilterClause }>(input.conditions).forEach((c, i) => {
        const found = validateEntityClauses(c.entity, [c.clause], catalog, `conditions[${i}].clause`);
        if (found.length) return issues.push(...found);
        const key = c.label.trim().toLowerCase();
        const control = doc.filters.controls.find((x) => x.kind === "condition" && x.label.trim().toLowerCase() === key);
        if (control) {
          next.on[control.id] = true;
          return;
        }
        next.temporary = next.temporary.filter((t) => !(t.kind === "condition" && t.label.trim().toLowerCase() === key));
        next.temporary.push({ kind: "condition", entity: c.entity, label: c.label.trim(), field: null, defaultValues: [], clause: c.clause, defaultOn: true });
      });

      if (issues.length) return invalid(issues, "Los filtros no se aplicaron");
      deps.applyFilterState(next);
      return { ok: true, filters: describeFilterState(next, doc.filters, ctx.pipelines) };
    }

    case "save_term": {
      const term = asString(input.term);
      const entity = input.entity as EntityId;
      const meaning = asArray<FilterClause>(input.meaning);
      if (!term) return { error: "Falta el término." };
      if (!(ENTITIES as readonly string[]).includes(entity)) return { error: `Objeto desconocido: ${String(entity)}.` };
      if (meaning.length === 0) return { error: "El significado necesita al menos una cláusula." };
      const issues = validateEntityClauses(entity, meaning, buildCatalog(deps.engineCtx()), "meaning");
      if (issues.length) return invalid(issues, "El término no se guardó");
      return outcome(
        await deps.commit(
          (d) =>
            saveTerm(
              d,
              { term: term.trim(), aliases: asArray<string>(input.aliases).map((a) => a.trim()).filter(Boolean), entity, meaning, note: typeof input.note === "string" ? input.note : "" },
              opMeta(deps)
            ),
          `Glosario: «${term}»`,
          "ai"
        )
      );
    }

    case "forget_term": {
      const term = asString(input.term) ?? "";
      return outcome(await deps.commit((d) => forgetTerm(d, term), `Glosario: olvidó «${term}»`, "ai"));
    }

    default:
      return { error: `Herramienta del panel desconocida: ${name}.` };
  }
}
