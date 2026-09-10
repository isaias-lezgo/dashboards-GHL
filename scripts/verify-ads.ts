// Verification for lib/ads.ts. Run: pnpm verify:ads
//
// Wrapped in main() rather than using top-level await: this package is CJS.
//
// Worth an assertion script for the same reason the roster and the limiter are:
// every bug in here is SILENT. A coercion that returns NaN, a ratio read off the
// API instead of recomputed, or a window that isn't clipped all produce a
// plausible-looking money number that is simply wrong — nobody eyeballs a CPL and
// notices it is 3x too good.
import assert from "node:assert/strict";
import {
  num,
  metaLeadsFrom,
  conversationsFrom,
  sumAdDays,
  costPer,
  adsWindow,
  daysInWindow,
  isWindowClipped,
  toDayKey,
  pautaAdId,
  joinPautasToAds,
  spendForAdIds,
  campaignsFromAds,
} from "../lib/ads";
import type { AdDay, AdsReport, AdStat, Pauta } from "../lib/types";

const day = (date: string, over: Partial<AdDay> = {}): AdDay => ({
  date,
  spend: 0,
  impressions: 0,
  clicks: 0,
  reach: 0,
  metaLeads: 0,
  conversations: 0,
  ...over,
});

async function main() {
  // --- num(): GHL sends every metric as a string, on some endpoints as a number.
  assert.equal(num("13971.29"), 13971.29, "decimal string");
  assert.equal(num("298574.00"), 298574, "trailing zeros");
  assert.equal(num(4), 4, "already a number");
  assert.equal(num("1,234.5"), 1234.5, "thousands separator");
  // Nothing may ever escape as NaN: a single NaN poisons every sum downstream
  // and blanks the whole section instead of the one bad field.
  assert.equal(num(undefined), 0, "undefined → 0");
  assert.equal(num(null), 0, "null → 0");
  assert.equal(num("n/a"), 0, "garbage → 0, never NaN");
  assert.equal(num(Infinity), 0, "non-finite → 0");
  assert.ok(!Number.isNaN(num("")), "empty string is never NaN");

  // --- metaLeadsFrom(): prefer `conversions`, fall back through the lead actions.
  // The action types OVERLAP, so the fallback must pick ONE, never sum them.
  assert.equal(metaLeadsFrom(4, { lead: 4, "onsiteConversion.leadGrouped": 3 }), 4, "conversions wins");
  assert.equal(
    metaLeadsFrom(0, { lead: "5", "onsiteConversion.lead": "5", "onsiteConversion.leadGrouped": "5" }),
    5,
    "overlapping lead actions are NOT summed",
  );
  assert.equal(metaLeadsFrom(0, { "onsiteConversion.leadGrouped": "3" }), 3, "falls through the order");
  // A real live row: a WhatsApp campaign day with no lead action at all.
  assert.equal(
    metaLeadsFrom(0, { linkClick: 464, "onsiteConversion.messagingConversationStarted_7d": 188 }),
    0,
    "clicks and conversations are not leads",
  );
  assert.equal(metaLeadsFrom(undefined, undefined), 0, "no data → 0");

  assert.equal(
    conversationsFrom({ "onsiteConversion.messagingConversationStarted_7d": "188" }),
    188,
    "conversations read from their own action type",
  );
  assert.equal(conversationsFrom(undefined), 0);

  // --- sumAdDays(): THE ratio bug. The API's own `totals` sums cpc/cpm/ctr
  // instead of weighting them — a live response came back ctr "21.94", cpm
  // "505.42". These must be recomputed from the summed components.
  const days = [
    day("2026-06-01", { spend: 100, impressions: 10_000, clicks: 100, reach: 500, metaLeads: 2 }),
    day("2026-06-02", { spend: 300, impressions: 10_000, clicks: 100, reach: 700, metaLeads: 3 }),
  ];
  const t = sumAdDays(days);
  assert.equal(t.spend, 400);
  assert.equal(t.clicks, 200);
  assert.equal(t.impressions, 20_000);
  assert.equal(t.metaLeads, 5);
  assert.equal(t.ctr, 1, "ctr = clicks/impressions, not the sum of daily ctrs");
  assert.equal(t.cpc, 2, "cpc = spend/clicks, weighted — NOT (1 + 3) / 2");
  assert.equal(t.cpm, 20, "cpm = spend/impressions*1000");
  assert.equal(t.reach, 1200);
  assert.equal(t.reachIsSum, true, "multi-day reach is flagged as a sum, not unique people");
  assert.equal(sumAdDays([days[0]]).reachIsSum, false, "a single day's reach is genuinely unique");

  // Empty input must not divide by zero.
  const empty = sumAdDays([]);
  assert.equal(empty.spend, 0);
  assert.equal(empty.ctr, 0);
  assert.equal(empty.cpc, 0);
  assert.equal(empty.cpm, 0);

  // --- costPer(): null, never Infinity. Spend with no leads is "—", and a cost
  // per lead of Infinity would render as "∞" or crash a currency formatter.
  assert.equal(costPer(400, 5), 80);
  assert.equal(costPer(400, 0), null, "no leads → null, never Infinity");
  assert.equal(costPer(0, 0), null);

  // --- adsWindow(): the clipping that keeps CPL honest.
  const report: AdsReport = {
    status: "connected",
    from: "2026-01-01",
    to: "2026-09-01",
    daily: [],
  };
  assert.deepEqual(
    adsWindow(report, null),
    { from: "2026-01-01", to: "2026-09-01" },
    "no filter → the whole fetched window",
  );
  // THE case this exists for: "Todo el historial" reaches back years before the
  // spend we hold. Without clipping, a year of spend would be divided by five
  // years of leads and report a CPL a fraction of the real one.
  assert.deepEqual(
    adsWindow(report, { from: new Date(2020, 0, 1), to: new Date(2026, 8, 1) }),
    { from: "2026-01-01", to: "2026-09-01" },
    "a filter older than the data is clipped to the data",
  );
  assert.deepEqual(
    adsWindow(report, { from: new Date(2026, 4, 1), to: new Date(2026, 5, 30) }),
    { from: "2026-05-01", to: "2026-06-30" },
    "a filter inside the data is used as-is",
  );
  assert.equal(
    adsWindow(report, { from: new Date(2019, 0, 1), to: new Date(2019, 11, 31) }),
    null,
    "no overlap at all → null, not an inverted range",
  );
  assert.equal(adsWindow(undefined, null), null, "no report → null");
  assert.equal(adsWindow({ status: "disconnected", daily: [] }, null), null, "no bounds → null");

  assert.equal(isWindowClipped(report, null), true, '"todo" always clips');
  assert.equal(
    isWindowClipped(report, { from: new Date(2020, 0, 1), to: new Date(2026, 8, 1) }),
    true,
    "a filter reaching before the data clips",
  );
  assert.equal(
    isWindowClipped(report, { from: new Date(2026, 4, 1), to: new Date(2026, 5, 30) }),
    false,
    "a filter inside the data does not clip",
  );

  // --- daysInWindow(): inclusive on BOTH ends. An exclusive end would drop the
  // most recent day of spend, every time.
  const series = [day("2026-05-31"), day("2026-06-01"), day("2026-06-15"), day("2026-07-01")];
  assert.deepEqual(
    daysInWindow(series, { from: "2026-06-01", to: "2026-07-01" }).map((d) => d.date),
    ["2026-06-01", "2026-06-15", "2026-07-01"],
    "both bounds are inclusive",
  );
  assert.deepEqual(daysInWindow(series, null), [], "no window → no days");

  // --- toDayKey(): LOCAL date, matching the date filter's day boundaries.
  // toISOString() would shift a Mexico-evening date to the next UTC day and
  // silently move that day's spend into the following bucket.
  const localNoon = new Date(2026, 5, 15, 12, 0, 0);
  assert.equal(toDayKey(localNoon), "2026-06-15");
  const localLateEvening = new Date(2026, 5, 15, 23, 30, 0);
  assert.equal(toDayKey(localLateEvening), "2026-06-15", "late evening stays on its local day");

  // --- pautaAdId(): the ONLY key that joins Meta to this CRM.
  const pauta = (props: Record<string, string>, over: Partial<Pauta> = {}): Pauta => ({
    id: "p", tipo: "t", nombrePauta: "n", createdAt: "2026-08-20", contactId: "c",
    properties: props, ...over,
  });
  // Real shape from stanza-residencial.
  assert.equal(
    pautaAdId(pauta({ id_de_pauta: "120251969488650130", telefono_contacto: "16182205462" })),
    "120251969488650130",
  );
  // Must not pick up the neighbouring properties — every one of these coexists
  // with the ad id on a real record.
  assert.equal(pautaAdId(pauta({ telefono_contacto: "16182205462", registro: "Dario - 1/9/2026" })), undefined);
  assert.equal(pautaAdId(pauta({ nombre_contacto: "Dario" })), undefined);
  assert.equal(pautaAdId(pauta({ fuente_de_pauta: "Mensaje WhatsApp" })), undefined);
  // Spelling varies per sub-account, so the match is loose on the key.
  assert.equal(pautaAdId(pauta({ "ID de Pauta": "123" })), "123");
  assert.equal(pautaAdId(pauta({ idPauta: "123" })), "123");
  // "-" is the Make scenario's placeholder for "no value", not an id.
  assert.equal(pautaAdId(pauta({ id_de_pauta: "-" })), undefined);
  assert.equal(pautaAdId(pauta({ id_de_pauta: "  " })), undefined);
  assert.equal(pautaAdId({ id: "p", tipo: "t", nombrePauta: "n", createdAt: "x" }), undefined);

  // --- joinPautasToAds(): counts, and keeps the two "no spend" reasons apart.
  const linked = new Set(["ad1", "ad2"]);
  const join = joinPautasToAds(
    [
      pauta({ id_de_pauta: "ad1" }),
      pauta({ id_de_pauta: "ad1" }),
      pauta({ id_de_pauta: "ad2" }),
      // A real ad, but in one of the sub-account's OTHER Meta ad accounts —
      // GHL links only one, so its spend is invisible, NOT zero.
      pauta({ id_de_pauta: "ad-from-another-account" }),
      pauta({ telefono_contacto: "555" }),
    ],
    linked,
  );
  assert.equal(join.leadsByAdId.get("ad1"), 2);
  assert.equal(join.leadsByAdId.get("ad2"), 1);
  assert.equal(join.matched, 3);
  assert.equal(join.unmatched, 2);
  assert.equal(join.unlinkedAccount, 1, "an ad id we cannot price is not the same as no ad id");
  assert.equal(join.noAdId, 1);
  assert.equal(join.leadsByAdId.has("ad-from-another-account"), false, "never invents a bucket");

  // --- spendForAdIds(): dedupes. Summing per pauta would multiply an ad's cost
  // by its own lead count — inflating exactly the number read as cost per lead.
  const adsById = new Map<string, AdStat>([
    ["ad1", { adId: "ad1", adName: "A", campaignId: "c1", campaignName: "C1", campaignStatus: "ACTIVE", spend: 100, impressions: 10, clicks: 5 }],
    ["ad2", { adId: "ad2", adName: "B", campaignId: "c1", campaignName: "C1", campaignStatus: "ACTIVE", spend: 50, impressions: 20, clicks: 7 }],
  ]);
  assert.equal(spendForAdIds(["ad1", "ad2"], adsById), 150);
  assert.equal(spendForAdIds(["ad1", "ad1", "ad1"], adsById), 100, "each ad counted once");
  assert.equal(spendForAdIds(["ad1", "nope"], adsById), 100, "unknown ids contribute 0");
  assert.equal(spendForAdIds([], adsById), 0);

  // --- campaignsFromAds(): roll ads up, attaching the CRM's own lead counts.
  const rolledCampaigns = campaignsFromAds(
    [
      adsById.get("ad1")!,
      adsById.get("ad2")!,
      { adId: "ad3", adName: "C", campaignId: "c2", campaignName: "C2", campaignStatus: "PAUSED", spend: 900, impressions: 1, clicks: 1 },
    ],
    new Map([["ad1", 2], ["ad2", 1]]),
  );
  assert.equal(rolledCampaigns.length, 2);
  assert.equal(rolledCampaigns[0].id, "c2", "sorted by spend descending");
  const c1 = rolledCampaigns.find((c) => c.id === "c1")!;
  assert.equal(c1.spend, 150, "two ads summed into one campaign");
  assert.equal(c1.clicks, 12);
  assert.equal(c1.leads, 3, "leads come from the pauta join, not GHL's CDP");
  const c2 = rolledCampaigns.find((c) => c.id === "c2")!;
  assert.equal(c2.leads, 0, "an ad with no pautas contributes 0, not undefined");
  assert.deepEqual(campaignsFromAds([], new Map()), []);

  console.log("verify:ads — all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
