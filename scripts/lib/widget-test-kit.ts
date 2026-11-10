// Shared helpers for the panel verification scripts (verify-widgets, verify-capabilities).
// Moved verbatim out of scripts/verify-widgets.ts so both scripts build the same fixtures.
import type { Appointment, Contact, Opportunity, Pauta, Pipeline } from "../../lib/types";
import type { ChatDataset } from "../../lib/ai-tools";
import type { EngineContext } from "../../lib/widgets/semantic";
import type { QueryResult } from "../../lib/widgets/engine";
import type { QuerySpec } from "../../lib/widgets/spec";

let currentSection = "";
export function section(name: string): void {
  currentSection = name;
  console.log(`\n— ${name}`);
}
export function check(name: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`  ✗ [${currentSection}] ${name}`);
    throw err;
  }
  console.log(`  ✓ ${name}`);
}
export async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`  ✗ [${currentSection}] ${name}`);
    throw err;
  }
  console.log(`  ✓ ${name}`);
}

export function mkContact(id: string, extra: Partial<Contact> = {}): Contact {
  return { id, name: id, email: "", phone: "", tags: [], dateAdded: "2026-08-01T12:00:00Z", createdAt: "2026-08-01T12:00:00Z", ...extra };
}
export function mkOpp(id: string, contactId: string, pipelineId: string, stage: string, createdAt: string, extra: Partial<Opportunity> = {}): Opportunity {
  return {
    id, name: id, pipelineId, pipelineStageId: stage, status: "open", createdAt, contactId,
    value: 0, stage, pipelineName: pipelineId, ...extra,
  };
}
export function mkAppt(id: string, contactId: string, startTime: string, status: string): Appointment {
  return { id, contactId, startTime, endTime: startTime, status };
}

export interface Fixture {
  ctx: EngineContext;
  c: Record<string, Contact>;
  o: Record<string, Opportunity>;
}

export function makeFixture(overrides: Partial<EngineContext> = {}): Fixture {
  const c = {
    c1: mkContact("c1", { tags: ["vip"], customFieldsResolved: { "Origen de Lead": ["Facebook", "Instagram"] } }),
    c2: mkContact("c2"),
    c3: mkContact("c3"),
    c4: mkContact("c4"),
  };
  const o = {
    o1: mkOpp("o1", "c1", "p1", "Primera Cita", "2026-09-01T12:00:00Z"),
    o2: mkOpp("o2", "c1", "p2", "Propuesta", "2026-10-01T12:00:00Z"),
    o3: mkOpp("o3", "c2", "p1", "Negocio Ganado", "2026-10-05T12:00:00Z", { value: 1000, closedAt: "2026-10-06T12:00:00Z" }),
    o4: mkOpp("o4", "c3", "p1", "Seguimiento", "2026-10-10T12:00:00Z", { status: "lost", lostReason: "Precio" }),
  };
  const pautas: Pauta[] = [
    { id: "p-a", tipo: "", nombrePauta: "", createdAt: "2026-09-01T12:00:00Z", contactId: "c1" },
    { id: "p-b", tipo: "", nombrePauta: "", createdAt: "2026-10-02T12:00:00Z", contactId: "c1" },
    { id: "p-c", tipo: "", nombrePauta: "", createdAt: "2026-10-03T12:00:00Z" },
  ];
  const dataset: ChatDataset = {
    contacts: Object.values(c),
    opportunities: Object.values(o),
    pautas,
    appointments: [
      mkAppt("a1", "c1", "2026-10-20T15:00:00Z", "showed"),
      mkAppt("a2", "c1", "2026-10-21T15:00:00Z", "noshow"),
      mkAppt("a3", "c1", "2026-10-22T15:00:00Z", "showed"),
      mkAppt("a4", "c4", "2026-10-23T15:00:00Z", "confirmed"),
    ],
    messages: [],
    tasks: [],
    calls: [],
  };
  const pipelines: Pipeline[] = [
    { id: "p1", name: "p1", stages: ["Primera Cita", "Negocio Ganado"] },
    { id: "p2", name: "p2", stages: ["Propuesta"] },
  ];
  const ctx: EngineContext = {
    dataset,
    pipelines,
    ads: undefined,
    dateRange: null,
    pipelineFilter: [],
    globalFilters: [],
    now: new Date(2026, 9, 29, 12, 0, 0),
    ...overrides,
  };
  return { ctx, c, o };
}

// A query with sensible defaults; tests override only what they exercise.
export function q(over: Partial<QuerySpec>): QuerySpec {
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
export const dim = (dimension: string, bucket: QuerySpec["groupBy"][number]["bucket"] = null, join: QuerySpec["groupBy"][number]["join"] = null) => ({ dimension, bucket, join });
export const byLabel = (res: QueryResult, metric = 0): Record<string, number | null> =>
  Object.fromEntries(res.rows.map((r) => [r.label.join(" · "), r.values[metric]]));
export const ids = (res: QueryResult): string[] => res.rows.flatMap((r) => r.records.map((x) => String(x.id))).sort();
