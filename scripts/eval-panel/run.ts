// Runs the panel copilot's natural-language eval against the real API:
//   pnpm eval:panel <clientId> [<clientId>…]
//
// SPENDS API MONEY (~30 cases × accounts × ~5 turns of claude-sonnet-5). Run
// it only with the owner's approval of the budget.
//
// Each case runs the same request the browser sends (buildChatRequest, panel
// mode) in a loop in Node, against the client's CACHED payload (read-only — no
// GHL call, no write to the client's saved panel: the doc lives in memory).
// ask_user is answered with its first option. Live-fetch tools (messages,
// notes, tasks of one contact) are not available here and say so.
//
// Wrapped in main() rather than using top-level await: this package is CJS.
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { format } from "date-fns";
import { readSync } from "../../lib/sync-store";
import { resolveClientById } from "../../lib/clients";
import { buildChatRequest } from "../../lib/chat-request";
import { buildDatasetSummary } from "../../lib/ai-context";
import { executeTool, type ChatDataset } from "../../lib/ai-tools";
import { estimateCost } from "../../lib/ai-pricing";
import { resolveDateRange } from "../../lib/date-range";
import type { DashboardPayload } from "../../lib/types";
import { executePanelTool, isPanelTool, type PanelToolDeps } from "../../lib/widgets/tools";
import { runQuery, type QueryResult } from "../../lib/widgets/engine";
import { buildPanelCatalogSummary, buildPanelSnapshot } from "../../lib/widgets/describe";
import { activeGlobalFilters, describeFilterState, initialFilterState, type PanelFilterState } from "../../lib/widgets/filter-state";
import { DocOpError, addWidgets, findWidget, randomId, saveTerm, type OpMeta } from "../../lib/widgets/doc-ops";
import { docProblem, emptyDoc, type DashboardDoc, type Widget, type WidgetSpec } from "../../lib/widgets/spec";
import type { EngineContext } from "../../lib/widgets/semantic";
import { CASES, type EvalCase } from "./corpus";

const MAX_TURNS = 15;
const TIMEZONE = "America/Mexico_City";
const LIVE_TOOLS = new Set(["get_contact_messages", "search_conversations", "get_contact_tasks", "get_contact_notes"]);
const TOLERANCE = 1e-6;

interface CaseResult {
  client: string;
  id: string;
  kind: EvalCase["kind"];
  expect: EvalCase["expect"];
  pass: boolean;
  reason: string;
  turns: number;
  cost: number;
  tools: string[];
  asked: boolean;
  specs: WidgetSpec[];
  answer: string;
}

const close = (a: number | null | undefined, b: number) => a !== null && a !== undefined && Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(b));

/** Does the widget's result show the reference: the KPI total, or every row by its first key? */
function matchesReference(ref: Record<string, number> | number, res: QueryResult): string | null {
  if (typeof ref === "number") return close(res.totals[0], ref) ? null : `total ${res.totals[0]} ≠ ${ref}`;
  const got = new Map<string, number>();
  for (const row of res.rows) got.set(row.key[0], (got.get(row.key[0]) ?? 0) + (row.values[0] ?? 0));
  for (const [k, v] of Object.entries(ref)) if (!close(got.get(k) ?? 0, v)) return `«${k}»: ${got.get(k) ?? 0} ≠ ${v}`;
  for (const [k, v] of got) if (!(k in ref) && v !== 0) return `fila de más «${k}» = ${v}`;
  return null;
}

async function runCase(c: EvalCase, clientId: string, payload: DashboardPayload, syncedAt: string, anthropic: Anthropic): Promise<CaseResult> {
  const now = new Date();
  const meta: OpMeta = { now: now.toISOString(), by: "user", id: randomId };
  let doc: DashboardDoc = emptyDoc();
  let setupIds: string[] = [];
  if (c.setup?.length) {
    const r = addWidgets(doc, { tabId: null, newTabTitle: c.setupTab ?? "Panel", widgets: c.setup, position: "end" }, meta);
    doc = r.doc;
    setupIds = r.widgetIds;
  }
  for (const g of c.glossary ?? []) doc = saveTerm(doc, g, meta);
  let activeTabId: string | null = doc.tabs[0]?.id ?? null;
  const selected = c.select ? setupIds[0] ?? null : null;
  let state: PanelFilterState = initialFilterState(doc.filters, now);

  const dataset: ChatDataset = {
    contacts: payload.contacts,
    opportunities: payload.opportunities,
    pautas: payload.pautas,
    appointments: payload.appointments,
    messages: [],
    tasks: payload.tasks,
    calls: payload.calls,
  };
  const ctxOf = (): EngineContext => ({
    dataset,
    pipelines: payload.pipelines,
    ads: payload.ads,
    dateRange: resolveDateRange(state.date, now),
    pipelineFilter: state.pipelines,
    globalFilters: activeGlobalFilters(state, doc.filters),
    now,
  });

  let mutations = 0;
  let asked = false;
  let askedFirst = false;
  const tools: string[] = [];
  const deps: PanelToolDeps = {
    getDoc: () => doc,
    commit: async (mutate) => {
      // Same checks as useDashboardDoc.commit: doc-op errors, then the doc schema.
      let next: DashboardDoc;
      try {
        next = mutate(doc);
      } catch (err) {
        if (err instanceof DocOpError) return { ok: false, reason: "invalid", message: err.message };
        throw err;
      }
      const problem = docProblem(next);
      if (problem) return { ok: false, reason: "invalid", message: problem };
      doc = next;
      mutations++;
      return { ok: true, version: mutations };
    },
    engineCtx: ctxOf,
    activeTabId: () => activeTabId,
    selectedWidgetId: () => selected,
    setActiveTab: (id) => {
      activeTabId = id;
    },
    getFilterState: () => state,
    applyFilterState: (next) => {
      state = next;
    },
    now: () => new Date().toISOString(),
    newId: randomId,
  };

  const datasetSummary = `${buildDatasetSummary(dataset, payload.locationId, syncedAt)}\n\n${buildPanelCatalogSummary(ctxOf())}`;
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: c.prompt },
        { type: "text", text: buildPanelSnapshot(doc, activeTabId, selected, describeFilterState(state, doc.filters, payload.pipelines)) },
      ],
    },
  ];

  let cost = 0;
  let turns = 0;
  let answer = "";
  for (; turns < MAX_TURNS; turns++) {
    const res = await anthropic.messages.create(buildChatRequest({ mode: "panel", datasetSummary, messages, userTimezone: TIMEZONE }));
    cost += estimateCost({
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
    });
    messages.push({ role: "assistant", content: res.content });
    for (const b of res.content) if (b.type === "text") answer = b.text;
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (uses.length === 0) {
      if (res.stop_reason === "max_tokens") {
        messages.push({ role: "user", content: "Continúa." });
        continue;
      }
      turns++;
      break;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of uses) {
      tools.push(tu.name);
      const input = tu.input as Record<string, unknown>;
      let result: unknown;
      try {
        if (tu.name === "ask_user") {
          asked = true;
          if (mutations === 0) askedFirst = true;
          const first = (input.options as { label: string; value?: string }[] | undefined)?.[0];
          result = { answer: [first?.value?.trim() || first?.label || "Sí"] };
        } else if (isPanelTool(tu.name)) {
          result = await executePanelTool(tu.name, input, deps);
        } else if (LIVE_TOOLS.has(tu.name)) {
          result = { error: "No disponible en la evaluación: es una consulta en vivo al CRM." };
        } else if (tu.name === "export_csv") {
          result = { success: true, filename: "eval.csv", rowCount: 0 };
        } else {
          result = executeTool(tu.name, input, dataset);
        }
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      const isError = !!result && typeof result === "object" && typeof (result as { error?: unknown }).error === "string";
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result), ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }

  // ─── Grade ──────────────────────────────────────────────────────────────────
  const created = doc.tabs.flatMap((t) => t.widgets).filter((w) => !setupIds.includes(w.id));
  const edited = selected ? findWidget(doc, selected)?.widget ?? null : null;
  const candidates: Widget[] = c.kind === "edit" ? (edited ? [edited] : []) : created;
  const specs: WidgetSpec[] = candidates.map(({ id: _i, createdAt: _c, createdBy: _b, updatedAt: _u, ...spec }) => spec);

  const widgetVerdict = (): { pass: boolean; reason: string } => {
    if (candidates.length === 0) return { pass: false, reason: "no creó ni editó un widget" };
    const reasons: string[] = [];
    for (const w of candidates) {
      if (c.check && !c.check(w)) {
        reasons.push(`«${w.title}» no cumple el check`);
        continue;
      }
      if (c.reference) {
        if (!w.query) {
          reasons.push(`«${w.title}» no tiene consulta`);
          continue;
        }
        let res: QueryResult;
        try {
          res = runQuery(w.query, ctxOf());
        } catch (err) {
          reasons.push(`«${w.title}»: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        const miss = matchesReference(c.reference(ctxOf()), res);
        if (miss) {
          reasons.push(`«${w.title}»: ${miss}`);
          continue;
        }
      }
      return { pass: true, reason: `«${w.title}» coincide` };
    }
    return { pass: false, reason: reasons.join("; ") };
  };

  let verdict: { pass: boolean; reason: string };
  switch (c.expect) {
    case "widget":
      verdict = widgetVerdict();
      break;
    case "widget_no_ask":
      verdict = asked ? { pass: false, reason: "preguntó aunque el concepto tenía una sola lectura (o estaba en el glosario)" } : widgetVerdict();
      break;
    case "ask":
      verdict = askedFirst ? { pass: true, reason: "preguntó antes de guardar" } : { pass: false, reason: asked ? "preguntó después de guardar" : "no preguntó" };
      break;
    case "confirm":
      verdict = askedFirst ? { pass: true, reason: "confirmó antes de borrar" } : { pass: false, reason: "borró sin confirmar" };
      break;
    case "filters_saved":
    case "filters_session":
      verdict = c.checkPanel?.(doc, state) ? { pass: true, reason: "filtros como se esperaba" } : { pass: false, reason: "los filtros no quedaron como se esperaba" };
      break;
    case "no_widget":
      verdict = created.length === 0 ? { pass: true, reason: "no inventó un widget" } : { pass: false, reason: `creó ${created.length} widget(s) para un concepto inexistente` };
      break;
  }

  return { client: clientId, id: c.id, kind: c.kind, expect: c.expect, ...verdict, turns, cost, tools, asked, specs, answer };
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Uso: pnpm eval:panel <clientId> [<clientId>…]");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY");
  const anthropic = new Anthropic();
  const results: CaseResult[] = [];

  for (const id of ids) {
    const client = await resolveClientById(id);
    if (!client) throw new Error(`${id}: no está en el roster`);
    const cached = await readSync(client);
    if (!cached) throw new Error(`${id}: sin payload en caché (abre su panel una vez para sincronizar)`);
    const syncedAt = String(cached.syncedAt);
    console.log(`\n=== ${id} (datos del ${syncedAt})`);
    for (const c of CASES) {
      if (c.clients && !c.clients.includes(id)) continue;
      const r = await runCase(c, id, cached.payload, syncedAt, anthropic);
      results.push(r);
      console.log(`${r.pass ? "✓" : "✗"} ${c.id} · ${r.turns} turnos · $${r.cost.toFixed(4)} · ${r.reason}`);
    }
  }

  const graded = results.filter((r) => r.kind === "create" || r.kind === "edit");
  const pct = (rs: CaseResult[]) => (rs.length ? (100 * rs.filter((r) => r.pass).length) / rs.length : 0);
  const total = results.reduce((s, r) => s + r.cost, 0);
  mkdirSync("eval-results", { recursive: true });
  const file = `eval-results/panel-${format(new Date(), "yyyy-MM-dd-HHmm")}.json`;
  writeFileSync(file, JSON.stringify({ clients: ids, results, createEditPct: pct(graded), overallPct: pct(results), cost: total }, null, 2));
  console.log(`\nCreación y edición: ${pct(graded).toFixed(1)}% (meta ≥90%) · todos: ${pct(results).toFixed(1)}% · costo: $${total.toFixed(2)}`);
  console.log(`Resultados en ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
