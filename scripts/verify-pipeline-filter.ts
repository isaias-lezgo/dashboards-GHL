// Verification for lib/pipeline-filter.ts. Run: pnpm verify:pipelines
//
// Wrapped in main() rather than using top-level await: this package is CJS.
//
// Worth an assertion script for the same reason lib/ads.ts is: every bug in here
// is SILENT. The pipeline lives only on the opportunity, so every other dataset
// is filtered by a DERIVED set of contact ids. Derive that set wrong — from the
// date-filtered opportunities, or keeping rows whose contact is unknown — and the
// panel still renders a full, plausible dashboard that is simply describing a
// different population than its own title claims.
import assert from "node:assert/strict";
import {
  contactIdsInPipelines,
  filterByContactIds,
  filterOpportunitiesByPipelines,
  isPipelineFilterActive,
  pipelineFilterLabel,
  selectedPipelines,
} from "../lib/pipeline-filter";
import type { Appointment, Opportunity, Pauta, Pipeline } from "../lib/types";

const opp = (
  id: string,
  pipelineId: string,
  contactId: string,
  createdAt = "2026-01-01T00:00:00Z"
): Opportunity =>
  ({
    id,
    name: id,
    pipelineId,
    pipelineStageId: "s1",
    status: "open",
    createdAt,
    contactId,
    value: 0,
    stage: "Nuevo",
    pipelineName: pipelineId,
  }) as Opportunity;

const pipeline = (id: string, name: string, stages: string[] = ["Nuevo"]): Pipeline => ({
  id,
  name,
  stages,
});

function main(): void {
  const pipelines = [
    pipeline("p1", "Enttorno", ["Nuevo", "Contactado", "Cierre"]),
    pipeline("p2", "Axos", ["Alta", "Baja"]),
    pipeline("p3", "Corretaje"),
  ];

  // c1 lives in p1, c2 in p2, c3 in both, c4 has no opportunity at all.
  const opportunities = [
    opp("o1", "p1", "c1"),
    opp("o2", "p2", "c2"),
    opp("o3", "p1", "c3"),
    opp("o4", "p2", "c3"),
  ];

  // --- inactive filter is a strict passthrough -----------------------------
  // The empty selection is the default state of the panel, so "no filter" must
  // cost nothing and change nothing — including for rows the active filter
  // would drop, like an appointment whose contact is unknown.
  assert.equal(isPipelineFilterActive([]), false);
  assert.equal(contactIdsInPipelines(opportunities, []), null);
  assert.equal(filterOpportunitiesByPipelines(opportunities, []), opportunities);
  assert.equal(filterByContactIds(opportunities, (o) => o.contactId, null), opportunities);
  // …and every pipeline stays available, so the stage axis keeps its current
  // behavior when nobody has touched the filter.
  assert.deepEqual(selectedPipelines(pipelines, []), pipelines);

  // --- opportunities filter on their own pipelineId ------------------------
  assert.deepEqual(
    filterOpportunitiesByPipelines(opportunities, ["p1"]).map((o) => o.id),
    ["o1", "o3"]
  );
  assert.deepEqual(
    filterOpportunitiesByPipelines(opportunities, ["p1", "p2"]).map((o) => o.id),
    ["o1", "o2", "o3", "o4"]
  );
  // A selection nobody's opportunities match empties the panel rather than
  // quietly falling back to "todos".
  assert.deepEqual(filterOpportunitiesByPipelines(opportunities, ["p3"]), []);

  // --- the derived contact set --------------------------------------------
  const inP1 = contactIdsInPipelines(opportunities, ["p1"]);
  assert.deepEqual([...inP1!].sort(), ["c1", "c3"]);
  // A contact in several pipelines belongs to each of them.
  assert.deepEqual([...contactIdsInPipelines(opportunities, ["p2"])!].sort(), ["c2", "c3"]);
  assert.deepEqual(
    [...contactIdsInPipelines(opportunities, ["p1", "p2"])!].sort(),
    ["c1", "c2", "c3"]
  );

  // --- everything else follows its contact ---------------------------------
  const pautas: Pauta[] = [
    { id: "pa1", tipo: "t", nombrePauta: "n", createdAt: "2026-01-01", contactId: "c1" },
    { id: "pa2", tipo: "t", nombrePauta: "n", createdAt: "2026-01-01", contactId: "c2" },
    { id: "pa3", tipo: "t", nombrePauta: "n", createdAt: "2026-01-01", contactId: "c4" },
    // No contactId at all: unattributable to any pipeline.
    { id: "pa4", tipo: "t", nombrePauta: "n", createdAt: "2026-01-01" },
  ];
  assert.deepEqual(
    filterByContactIds(pautas, (p) => p.contactId, inP1).map((p) => p.id),
    ["pa1"]
  );

  // c4 has no opportunity in ANY pipeline. It is dropped, not kept: the panel
  // was designed to describe one population, and keeping the unattributable
  // rows was the explicitly rejected alternative. This is the assertion that
  // fails if someone "fixes" the lead count by letting orphans through.
  assert.equal(
    filterByContactIds(pautas, (p) => p.contactId, inP1).some((p) => p.contactId === "c4"),
    false
  );
  // Same for a row with no contact id — including one whose accessor returns "".
  assert.deepEqual(
    filterByContactIds(pautas, (p) => p.contactId ?? "", inP1).map((p) => p.id),
    ["pa1"]
  );

  const appointments: Appointment[] = [
    { id: "a1", contactId: "c3", startTime: "2026-02-01", endTime: "2026-02-01", status: "showed" },
    { id: "a2", contactId: "c2", startTime: "2026-02-01", endTime: "2026-02-01", status: "showed" },
  ];
  assert.deepEqual(
    filterByContactIds(appointments, (a) => a.contactId, inP1).map((a) => a.id),
    ["a1"]
  );

  // --- the derived set must come from the UNFILTERED opportunities ---------
  // A contact whose only in-pipeline opportunity predates the active date
  // window still belongs to that pipeline. Deriving the set from the
  // date-filtered slice — the tempting shortcut in app/page.tsx — would drop
  // that contact and every pauta, cita and mensaje hanging off them, silently
  // understating the lead volume of exactly the accounts with the longest
  // history. This is the same invariant the drill-down joins already carry.
  const older = opp("o5", "p1", "c9", "2020-05-05T00:00:00Z");
  const all = [...opportunities, older];
  const dateFiltered = all.filter((o) => o.createdAt >= "2026-01-01");
  assert.equal(contactIdsInPipelines(all, ["p1"])!.has("c9"), true);
  assert.equal(contactIdsInPipelines(dateFiltered, ["p1"])!.has("c9"), false);

  // --- selected pipelines drive the stage axis -----------------------------
  // One pipeline selected means the stage axis is finally that pipeline's own
  // stages, in GHL's order, instead of every account's stages merged together.
  assert.deepEqual(
    selectedPipelines(pipelines, ["p1"]).flatMap((p) => p.stages),
    ["Nuevo", "Contactado", "Cierre"]
  );
  // Order follows the account's pipeline order, not the click order.
  assert.deepEqual(
    selectedPipelines(pipelines, ["p2", "p1"]).map((p) => p.id),
    ["p1", "p2"]
  );
  // An id that no longer exists (a pipeline deleted in GHL) is ignored rather
  // than crashing the axis.
  assert.deepEqual(
    selectedPipelines(pipelines, ["p1", "gone"]).map((p) => p.id),
    ["p1"]
  );

  // --- labels ---------------------------------------------------------------
  assert.equal(pipelineFilterLabel(pipelines, []), "Todos los pipelines");
  assert.equal(pipelineFilterLabel(pipelines, ["p1"]), "Enttorno");
  assert.equal(pipelineFilterLabel(pipelines, ["p1", "p2"]), "2 pipelines");
  assert.equal(pipelineFilterLabel(pipelines, ["gone"]), "1 pipeline");

  console.log("✅ lib/pipeline-filter.ts — all assertions passed");
}

main();
