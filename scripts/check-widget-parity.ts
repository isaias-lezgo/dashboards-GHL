// Phase 0 gate of the AI panel: does the engine reproduce the hand-built
// dashboards' numbers on REAL accounts? Run: pnpm check:widget-parity <clientId> [<clientId>…]
//
// Read-only. Loads each client's cached payload from project_sync — never calls
// GHL, never writes. For every chart below, the reference is a COPY of the
// dashboard's own code (each cites its file and lines), deliberately independent
// of lib/widgets/*: a check that imported the engine would grade itself.
//
// Wrapped in main() rather than using top-level await: this package is CJS.
import { readSync } from "../lib/sync-store";
import { resolveClientById } from "../lib/clients";
import { filterByDateRange, resolveDateRange, type ResolvedDateRange } from "../lib/date-range";
import { contactIdsInPipelines, filterByContactIds, filterOpportunitiesByPipelines } from "../lib/pipeline-filter";
import { isWonOpp } from "../lib/opportunity-status";
import { platformLabel, sourceCategory } from "../lib/source-platform";
import type { DashboardPayload, Opportunity } from "../lib/types";
import { runQuery } from "../lib/widgets/engine";
import type { EngineContext } from "../lib/widgets/semantic";
import type { MetricId, QuerySpec } from "../lib/widgets/spec";

type Counts = Record<string, number>;

const EMPTY = "(sin valor)";
const TOLERANCE = 1e-9;

// ─── References: copied from the dashboards ───────────────────────────────────

// marketing-dashboard.tsx — leadsByCategory (~L553): opportunities per source
// category (summed across platforms, which is what each category bar totals).
function refBySourceCategory(opps: Opportunity[]): Counts {
  const out: Counts = {};
  for (const o of opps) {
    const cat = sourceCategory(o);
    out[cat] = (out[cat] ?? 0) + 1;
  }
  return out;
}

// sales-dashboard.tsx:425-465 — pipelineMatrix rows ("Estado actual del embudo").
function refFunnel(opps: Opportunity[]): Counts {
  const out: Counts = {};
  const openOpps = opps.filter((o) => o.status === "open" && !isWonOpp(o));
  const wonStagePattern = /ganad[oa]|\bwon\b/i;
  const stages = [...new Set(opps.map((o) => o.stage).filter((s) => !wonStagePattern.test(s ?? "")))];
  for (const s of stages) out[s] = openOpps.filter((o) => o.stage === s).length;
  out["Ganado"] = opps.filter(isWonOpp).length;
  out["Abandonado"] = opps.filter((o) => o.status === "abandoned").length;
  out["Perdido"] = opps.filter((o) => o.status === "lost").length;
  return out;
}

// sales-dashboard.tsx:366-391 — apptOutcomeData ("Resultado de las citas").
function refApptOutcome(appts: DashboardPayload["appointments"]): Counts {
  const out: Counts = {};
  for (const a of appts) out[a.status] = (out[a.status] ?? 0) + 1;
  return out;
}

// sales-dashboard.tsx:393-400 — lossGroupsData (before its top-5 fold).
function refLossReasons(opps: Opportunity[]): Counts {
  const out: Counts = {};
  for (const o of opps.filter((x) => x.status === "lost")) {
    const reason = o.lostReason ?? "Sin razón";
    out[reason] = (out[reason] ?? 0) + 1;
  }
  return out;
}

// sales-dashboard.tsx:179-189 — kpiMetrics (Conversión, Ingreso ganado).
function refKpis(opps: Opportunity[]): { conversion: number; wonRevenue: number } {
  const total = opps.length;
  const won = opps.filter(isWonOpp).length;
  return {
    conversion: total > 0 ? won / total : 0, // the dashboard shows ×100
    wonRevenue: opps.filter(isWonOpp).reduce((sum, o) => sum + o.value, 0),
  };
}

// sales-dashboard.tsx:340-360 — origenData (opportunities and conversión a cita per platform).
function refOrigen(opps: Opportunity[], appts: DashboardPayload["appointments"]): { counts: Counts; rates: Counts } {
  const apptIds = new Set(appts.map((a) => a.contactId));
  const counts: Counts = {};
  const rates: Counts = {};
  const byPlatform = new Map<string, Opportunity[]>();
  for (const o of opps) {
    const p = platformLabel(o);
    if (!byPlatform.has(p)) byPlatform.set(p, []);
    byPlatform.get(p)!.push(o);
  }
  for (const [platform, list] of byPlatform) {
    counts[platform] = list.length;
    rates[platform] = list.length > 0 ? list.filter((o) => apptIds.has(o.contactId)).length / list.length : 0;
  }
  return { counts, rates };
}

// ─── Engine side ──────────────────────────────────────────────────────────────

function query(over: Partial<QuerySpec>): QuerySpec {
  return {
    source: "opportunities",
    metrics: [{ metric: "count", label: null }],
    groupBy: [],
    filters: [],
    relatedFilters: [],
    time: { field: "createdAt", range: "inherit", from: null, to: null, compare: "none" },
    globalFilters: "inherit",
    sort: { by: "value", dir: "desc" },
    limit: null,
    ...over,
  };
}

function engineCounts(ctx: EngineContext, q: QuerySpec, metricIndex = 0): Counts {
  const out: Counts = {};
  // Keys, not labels: labels are translated for display ("showed" → "Asistió").
  for (const row of runQuery(q, ctx).rows) out[row.key.join(" · ")] = row.values[metricIndex] ?? 0;
  return out;
}

// ─── Comparison ───────────────────────────────────────────────────────────────

const normLabel = (k: string): string => (k === "" || k === "Sin razón" ? EMPTY : k);

function diff(ref: Counts, eng: Counts, exact: boolean): string[] {
  const norm = (c: Counts) => {
    const out: Counts = {};
    for (const [k, v] of Object.entries(c)) out[normLabel(k)] = (out[normLabel(k)] ?? 0) + v;
    return out;
  };
  const a = norm(ref);
  const b = norm(eng);
  const problems: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    const same = exact ? x === y : Math.abs(x - y) <= TOLERANCE;
    if (!same) problems.push(`«${k}»: tablero ${x} vs motor ${y}`);
  }
  return problems;
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Uso: pnpm check:widget-parity <clientId> [<clientId>…]");
    process.exit(2);
  }
  let failures = 0;
  const now = new Date();

  for (const id of ids) {
    const client = await resolveClientById(id);
    if (!client) {
      console.error(`❌ ${id}: no está en el roster`);
      failures++;
      continue;
    }
    const cached = await readSync(client);
    if (!cached) {
      console.error(`❌ ${id}: sin payload en caché (abre su panel una vez para sincronizar)`);
      failures++;
      continue;
    }
    const p = cached.payload;
    const byPipeline = new Map<string, number>();
    for (const o of p.opportunities) byPipeline.set(o.pipelineId, (byPipeline.get(o.pipelineId) ?? 0) + 1);
    const topPipeline = [...byPipeline.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const topName = p.pipelines.find((x) => x.id === topPipeline)?.name ?? topPipeline;

    console.log(`\n${client.name} (${id}) — ${p.contacts.length} contactos · ${p.opportunities.length} oportunidades · ${p.appointments.length} citas · sincronizado ${cached.syncedAt}`);

    const ranges: Array<[string, ResolvedDateRange | null]> = [
      ["todo", null],
      ["últimos 30 días", resolveDateRange({ preset: "month" }, now)],
    ];
    const pipelineFilters: Array<[string, string[]]> = [["sin pipeline", []]];
    if (topPipeline) pipelineFilters.push([`pipeline «${topName}»`, [topPipeline]]);

    for (const [rangeLabel, range] of ranges) {
      for (const [pfLabel, pf] of pipelineFilters) {
        // The exact slices app/page.tsx hands the dashboards.
        const opps = filterOpportunitiesByPipelines(filterByDateRange(p.opportunities, (o) => o.createdAt, range), pf);
        const appts = filterByContactIds(
          filterByDateRange(p.appointments, (a) => a.startTime, range),
          (a) => a.contactId,
          contactIdsInPipelines(p.opportunities, pf)
        );
        const ctx: EngineContext = {
          dataset: { contacts: p.contacts, opportunities: p.opportunities, pautas: p.pautas, appointments: p.appointments, messages: [], tasks: p.tasks, calls: p.calls },
          pipelines: p.pipelines,
          ads: p.ads,
          dateRange: range,
          pipelineFilter: pf,
          globalFilters: [],
          now,
        };
        const kpi = refKpis(opps);
        const origen = refOrigen(opps, appts);
        const kpiQ = (metric: MetricId) => engineCounts(ctx, query({ metrics: [{ metric, label: null }] }));
        const apptQ = query({
          source: "appointments",
          groupBy: [{ dimension: "status", bucket: null, join: null }],
          time: { field: "startTime", range: "inherit", from: null, to: null, compare: "none" },
        });
        const origenQ = query({
          groupBy: [{ dimension: "platform", bucket: null, join: null }],
          metrics: [{ metric: "count", label: null }, { metric: "appointment_rate", label: null }],
        });
        const checks: Array<[string, string[]]> = [
          ["Oportunidades por fuente", diff(refBySourceCategory(opps), engineCounts(ctx, query({ groupBy: [{ dimension: "sourceCategory", bucket: null, join: null }] })), true)],
          ["Estado actual del embudo", diff(refFunnel(opps), engineCounts(ctx, query({ groupBy: [{ dimension: "funnelState", bucket: null, join: null }] })), true)],
          ["Resultado de las citas", diff(refApptOutcome(appts), engineCounts(ctx, apptQ), true)],
          [
            "Razones de pérdida",
            diff(
              refLossReasons(opps),
              engineCounts(ctx, query({ groupBy: [{ dimension: "lostReason", bucket: null, join: null }], filters: [{ anyOf: [{ field: "status", op: "eq", values: ["lost"] }] }] })),
              true
            ),
          ],
          ["KPI Conversión", diff({ "": opps.length ? kpi.conversion : 0 }, { "": kpiQ("win_rate")[""] ?? 0 }, false)],
          ["KPI Ingreso ganado", diff({ "": kpi.wonRevenue }, kpiQ("won_value"), false)],
          ["Origen · oportunidades", diff(origen.counts, engineCounts(ctx, origenQ, 0), true)],
          ["Origen · conversión a cita", diff(origen.rates, engineCounts(ctx, origenQ, 1), false)],
        ];
        for (const [name, problems] of checks) {
          const tag = `${rangeLabel} · ${pfLabel}`;
          if (problems.length === 0) console.log(`  ✅ ${name} [${tag}]`);
          else {
            failures++;
            console.log(`  ❌ ${name} [${tag}]`);
            for (const pr of problems.slice(0, 8)) console.log(`       ${pr}`);
          }
        }
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} comprobación(es) con diferencias.`);
    process.exit(1);
  }
  console.log("\n✅ El motor reproduce los tableros en todas las comprobaciones.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
