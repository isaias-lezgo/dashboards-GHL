// Read-only reference check: the panel engine against the hand-built VAEO
// dashboard's own logic, on the real caches of OTHER accounts (VAEO does not have
// the app installed). Run: pnpm check:vaeo-reference [--live]
//
// The references below are PORTED from DASHBOARDS_VAEO/lib — opportunity-
// breakdown.ts (estado por mes), sales-series.ts (ventas por dimensión) and
// stale-opportunity-matrix.ts (sin atención) — and deliberately do NOT import
// lib/widgets/*: a check that used the engine would grade itself.
//
// --live also loads lezgo-suite's conversation index from GHL (read-only) for the
// "sin atención" matrix.
import { readSync } from "../lib/sync-store";
import { resolveClientById } from "../lib/clients";
import { withClient } from "../lib/ghl-context";
import { loadConversationIndex } from "../lib/conversation-index-load";
import { contactMessageDates, type ConversationState } from "../lib/conversation-index";
import type { Contact, DashboardPayload, Opportunity } from "../lib/types";
import { runQuery } from "../lib/widgets/engine";
import type { EngineContext } from "../lib/widgets/semantic";
import type { QuerySpec } from "../lib/widgets/spec";

// ─── References (ported from DASHBOARDS_VAEO/lib) ─────────────────────────────

const WON_STAGE = /ganad[oa]|\bwon\b/i;
const isWon = (o: Opportunity) => o.status === "won" || (o.status !== "lost" && o.status !== "abandoned" && WON_STAGE.test(o.stage ?? ""));
type Bucket = "ganada" | "abierta" | "perdida";
const statusBucket = (o: Opportunity): Bucket => (isWon(o) ? "ganada" : o.status === "lost" || o.status === "abandoned" ? "perdida" : "abierta");

/** VAEO monthKeyOf: the LOCAL month of an ISO date. */
function monthKeyOf(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function statusByMonth(opps: Opportunity[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of opps) {
    const key = `${monthKeyOf(o.createdAt) ?? "sin-fecha"}|${statusBucket(o)}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

function cfFirst(resolved: Record<string, string | string[]> | undefined, name: string): string[] {
  if (!resolved) return [];
  const key = Object.keys(resolved).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = key ? resolved[key] : undefined;
  return (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((s) => s.trim() !== "");
}

/** VAEO buildSalesSeries reduced to one dimension: sum of `measure` per key, with the "first filled field" rule of DRT. */
function sumBy(opps: Opportunity[], include: (o: Opportunity) => boolean, keysOf: (o: Opportunity) => string[], measure: (o: Opportunity) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of opps) {
    if (!include(o)) continue;
    for (const k of keysOf(o)) out.set(k, (out.get(k) ?? 0) + measure(o));
  }
  return out;
}

// VAEO stale-opportunity-matrix: buckets 0–7, 8–15, 16–30, 31–60, +60; no date = deepest.
const STALE_KEYS = ["0-7", "8-15", "16-30", "31-60", "60+"] as const;
const CLOSED_STAGES = [/ganad[oa]|\bwon\b/i, /perdid/i, /cliente\s+futuro/i];
const isLiveStage = (stage: string) => !CLOSED_STAGES.some((re) => re.test((stage ?? "").trim()));

/**
 * Whole days since a date. VAEO counts elapsed 24 h periods; the panel counts
 * CALENDAR days ("hace 8 días" = eight dates ago), the rule its Spanish labels
 * promise. The strict check uses calendar days; elapsed days are reported apart.
 */
function daysSince(iso: string | null | undefined, now: Date, rule: "calendar" | "elapsed"): number | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  if (rule === "elapsed") return Math.max(0, Math.floor((now.getTime() - t.getTime()) / 86_400_000));
  const a = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
function bucketOfDays(days: number | null): string {
  if (days === null) return "60+";
  if (days <= 7) return "0-7";
  if (days <= 15) return "8-15";
  if (days <= 30) return "16-30";
  if (days <= 60) return "31-60";
  return "60+";
}
function staleMatrix(opps: Opportunity[], lastOutbound: Map<string, string | null>, now: Date, rule: "calendar" | "elapsed"): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of opps) {
    if (o.status !== "open" || !isLiveStage(o.stage ?? "")) continue;
    const move = bucketOfDays(daysSince(o.lastStageChangeAt ?? o.createdAt, now, rule));
    const msg = bucketOfDays(daysSince(lastOutbound.get(o.contactId) ?? null, now, rule));
    out.set(`${move}|${msg}`, (out.get(`${move}|${msg}`) ?? 0) + 1);
  }
  return out;
}

// ─── Engine side ──────────────────────────────────────────────────────────────

const ALL = { field: "createdAt", range: "all" as const, from: null, to: null, compare: "none" as const };
const base = (over: Partial<QuerySpec>): QuerySpec => ({
  source: "opportunities",
  metrics: [{ metric: "count", label: null }],
  groupBy: [],
  filters: [],
  relatedFilters: [],
  time: ALL,
  globalFilters: "inherit",
  sort: { by: "natural", dir: "asc" },
  limit: null,
  ...over,
});

function ctxOf(p: DashboardPayload, now: Date, conversations?: ConversationState): EngineContext {
  return {
    dataset: { contacts: p.contacts, opportunities: p.opportunities, pautas: p.pautas, appointments: p.appointments, messages: [], tasks: p.tasks, calls: p.calls },
    pipelines: p.pipelines,
    ads: p.ads,
    dateRange: null,
    pipelineFilter: [],
    globalFilters: [],
    now,
    customFieldTypes: p.customFieldTypes ?? null,
    conversations,
  };
}

/** Engine rows as "k1|k2" → value, with the engine's keys translated to the reference's. */
function engineMap(q: QuerySpec, ctx: EngineContext, translate: (key: string[]) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of runQuery(q, ctx).rows) {
    const v = r.values[0] ?? 0;
    if (v === 0) continue;
    const k = translate(r.key);
    out.set(k, (out.get(k) ?? 0) + v);
  }
  return out;
}

let failures = 0;
function compare(label: string, ref: Map<string, number>, eng: Map<string, number>): void {
  const keys = new Set([...ref.keys(), ...eng.keys()]);
  const bad = [...keys].filter((k) => Math.abs((ref.get(k) ?? 0) - (eng.get(k) ?? 0)) > 1e-6);
  if (bad.length === 0) {
    console.log(`  ✓ ${label} ${keys.size}/${keys.size}`);
    return;
  }
  failures++;
  console.log(`  ✗ ${label}: ${bad.length} de ${keys.size} celdas difieren; primera «${bad[0]}»: referencia ${ref.get(bad[0]) ?? 0}, motor ${eng.get(bad[0]) ?? 0}`);
}

const OUTCOME: Record<string, Bucket> = { Ganada: "ganada", Abierta: "abierta", Perdida: "perdida" };
const EMPTY = "(sin valor)";

const COMBINED: Record<string, [string, string]> = {
  "condesa-cimatario": ["Canal de contacto", "Canal de Contacto"],
  "stanza-residencial": ["Canal de Prospección del Lead", "Canal de Prospección"],
  "rise-29": ["Proyecto", "Proyecto"],
};

async function main(): Promise<void> {
  const live = process.argv.includes("--live");
  const ids = ["lezgo-suite", "condesa-cimatario", "stanza-residencial", "rise-29"];
  const now = new Date();

  for (const id of ids) {
    const client = await resolveClientById(id);
    const cached = client ? await readSync(client) : null;
    if (!client || !cached) {
      console.log(`✗ ${id}: sin cliente o sin caché`);
      failures++;
      continue;
    }
    const p = cached.payload;
    const ctx = ctxOf(p, now);
    console.log(`\n${client.name} (${id}) — ${p.opportunities.length} oportunidades · sincronizado ${cached.syncedAt}`);

    // 1. Oportunidades por estado, por mes de creación.
    compare(
      "estado por mes",
      statusByMonth(p.opportunities),
      engineMap(base({ groupBy: [{ dimension: "createdAt", bucket: "month", join: null }, { dimension: "outcome", bucket: null, join: null }] }), ctx, (k) => `${k[0] === EMPTY ? "sin-fecha" : k[0]}|${OUTCOME[k[1]]}`)
    );

    // 2. Ventas ganadas (valor) por mes de una fecha secundaria. closedAt viene vacío en
    //    estas cuentas, así que se usa el último cambio de estado, que todas traen.
    compare(
      "ventas por mes del último cambio de estado",
      sumBy(p.opportunities, isWon, (o) => [monthKeyOf(o.lastStatusChangeAt) ?? "sin-fecha"], (o) => o.value ?? 0),
      engineMap(
        base({ metrics: [{ metric: "value_sum", label: null }], filters: [{ anyOf: [{ field: "won", op: "eq", values: ["true"] }] }], groupBy: [{ dimension: "lastStatusChangeAt", bucket: "month", join: null }], time: { ...ALL, field: "lastStatusChangeAt" } }),
        ctx,
        (k) => (k[0] === EMPTY ? "sin-fecha" : k[0])
      )
    );

    // 3. Campo combinado: el de la oportunidad y, si está vacío, el del contacto (regla de DRT).
    const combo = COMBINED[id];
    if (combo) {
      const contactById = new Map<string, Contact>(p.contacts.map((c) => [c.id, c]));
      const keysOf = (o: Opportunity) => {
        const own = cfFirst(o.customFieldsResolved, combo[0]);
        if (own.length) return own;
        const fromContact = cfFirst(contactById.get(o.contactId)?.customFieldsResolved, combo[1]);
        return fromContact.length ? fromContact : [EMPTY];
      };
      compare(
        `oportunidades por «${combo[0]}» → contacto «${combo[1]}»`,
        sumBy(p.opportunities, () => true, keysOf, () => 1),
        engineMap(base({ groupBy: [{ dimension: `cf:${combo[0]}`, bucket: null, join: null, fallbacks: [`contact.cf:${combo[1]}`] }] }), ctx, (k) => k[0])
      );
    }

    // 4. Sin atención (VAEO), con las conversaciones reales de lezgo-suite.
    if (live && id === "lezgo-suite") {
      const started = Date.now();
      const loaded = await withClient(client, () => loadConversationIndex(60));
      console.log(`  · conversaciones: ${loaded.rows.length} en ${Math.round((Date.now() - started) / 1000)} s (hilos con error: ${loaded.threadErrors})`);
      const conversations: ConversationState = { status: "ready", days: 60, rows: loaded.rows, byContact: contactMessageDates(loaded.rows), truncated: loaded.truncated, threadErrors: loaded.threadErrors };
      const lastOutbound = new Map([...conversations.byContact].map(([c, d]) => [c, d.lastOutboundAt]));
      const closed = [...new Set(p.pipelines.flatMap((x) => x.stages))].filter((s) => !isLiveStage(s));
      const AGE: Record<string, string> = { a0: "0-7", a1: "8-15", a2: "16-30", a3: "31-60", a4: "60+", beyond: "60+", future: "0-7", [EMPTY]: "60+" };
      const q = base({
        groupBy: [
          { dimension: "lastStageChangeAt", bucket: "age", join: null },
          { dimension: "contact.lastOutboundAt", bucket: "age", join: null },
        ],
        filters: [{ anyOf: [{ field: "status", op: "eq", values: ["open"] }] }, ...(closed.length ? [{ anyOf: [{ field: "stage", op: "not_in" as const, values: closed }] }] : [])],
      });
      const eng = engineMap(q, ctxOf(p, now, conversations), (k) => `${AGE[k[0]]}|${AGE[k[1]]}`);
      compare("sin atención (días de calendario)", staleMatrix(p.opportunities, lastOutbound, now, "calendar"), eng);
      const elapsed = staleMatrix(p.opportunities, lastOutbound, now, "elapsed");
      const cal = staleMatrix(p.opportunities, lastOutbound, now, "calendar");
      const moved = [...new Set([...elapsed.keys(), ...cal.keys()])].reduce((n, k) => n + Math.abs((elapsed.get(k) ?? 0) - (cal.get(k) ?? 0)), 0) / 2;
      console.log(`  · con la regla de VAEO (periodos de 24 h) cambiarían de celda ${moved} oportunidades`);
    }
  }

  console.log(failures ? `\n❌ ${failures} comprobaciones no coinciden.` : "\n✅ El motor reproduce la lógica de VAEO en todas las comprobaciones.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
