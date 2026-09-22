// Pure helpers over the Meta ad-spend report. Shared by the server (lib/ads-sync.ts
// builds the payload) and the browser (components/dashboard/ads-section.tsx sums it
// over the active date filter), so this module must stay free of any GHL import —
// pulling lib/ghl-client in here would drag the token into the client bundle.
//
// Two things live here because getting either wrong is silent and expensive:
// coercing GHL's stringly-typed metrics, and recomputing the ratio metrics
// instead of trusting the ones the API sends back.

import type { AdDay, AdsReport, AdsStatus, AdCampaignStat, AdStat, Pauta } from "@/lib/types"
import type { ResolvedDateRange } from "@/lib/date-range"

/**
 * Coerce a GHL metric to a number. Every metric arrives as a string on at least
 * one endpoint ("spend": "13971.29"), and `conversions` is a number at account
 * level but a string at campaign level, so nothing may be trusted to be numeric.
 * Anything unparseable becomes 0 rather than NaN — a NaN would propagate through
 * every sum and blank the whole section instead of the one bad field.
 */
export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

// Meta action types that mean "someone became a lead". These OVERLAP by design
// on Meta's side (a single lead can show up as `lead`, `onsiteConversion.lead`
// and `onsiteConversion.leadGrouped` at once), so we never sum them — we take
// the first one present, in descending order of trust. Ordered, not a Set.
const LEAD_ACTION_KEYS = [
  "lead",
  "onsiteConversion.lead",
  "onsiteConversion.leadGrouped",
  "onsiteWebLead",
  "offsiteConversion.fbPixelLead",
] as const

// WhatsApp / Messenger campaigns produce no `lead` action at all — their
// equivalent is a conversation started. Tracked separately rather than folded
// into leads, because the two are not interchangeable and which one matters
// depends on the campaign objective.
const CONVERSATION_ACTION_KEY = "onsiteConversion.messagingConversationStarted_7d"

/**
 * Meta's own lead count for a row. Prefers the top-level `conversions` field
 * (which is what GHL's own UI shows) and falls back to the first present lead
 * action. Kept only as a cross-check: the headline CPL is computed against the
 * CRM's leads, because Meta's action types overlap and a WhatsApp campaign's
 * real lead is a conversation, not a `lead` action.
 */
export function metaLeadsFrom(
  conversions: unknown,
  results?: Record<string, unknown>
): number {
  const direct = num(conversions)
  if (direct > 0) return direct
  if (!results) return 0
  for (const key of LEAD_ACTION_KEYS) {
    const v = num(results[key])
    if (v > 0) return v
  }
  return 0
}

/** `onsiteConversion.messagingConversationStarted_7d`, or 0. */
export function conversationsFrom(results?: Record<string, unknown>): number {
  return results ? num(results[CONVERSATION_ACTION_KEY]) : 0
}

/** An AdsReport carrying no data, for every path that is not "connected". */
export function emptyAdsReport(status: AdsStatus, message?: string): AdsReport {
  return { status, message, daily: [] }
}

export interface AdTotals {
  spend: number
  impressions: number
  clicks: number
  /** Sum of daily unique reach. NOT deduplicated — see the note on `reachIsSum`. */
  reach: number
  metaLeads: number
  conversations: number
  /** Derived, recomputed from the sums above — never read off the API. */
  ctr: number
  cpc: number
  cpm: number
  /**
   * True whenever more than one day is summed, meaning `reach` double-counts
   * anyone Meta reached on several days. Meta only deduplicates reach within a
   * single query window and we query per day, so the honest thing is to flag it
   * rather than present a number that overstates the audience.
   */
  reachIsSum: boolean
}

/**
 * Sum daily rows and RECOMPUTE the ratios. The API's own `totals` adds ctr/cpc/cpm
 * together instead of weighting them — a live response came back with ctr 21.94%
 * and cpm 505.42 — so those fields are unusable and we never read them.
 */
export function sumAdDays(days: AdDay[]): AdTotals {
  let spend = 0, impressions = 0, clicks = 0, reach = 0, metaLeads = 0, conversations = 0
  for (const d of days) {
    spend += d.spend
    impressions += d.impressions
    clicks += d.clicks
    reach += d.reach
    metaLeads += d.metaLeads
    conversations += d.conversations
  }
  return {
    spend,
    impressions,
    clicks,
    reach,
    metaLeads,
    conversations,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    reachIsSum: days.length > 1,
  }
}

/** Cost per unit, or null when there is nothing to divide by — never Infinity. */
export function costPer(spend: number, count: number): number | null {
  return count > 0 ? spend / count : null
}

/** YYYY-MM-DD in local time, matching the day boundaries the date filter uses. */
export function toDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * The first day the CRM holds any record at all, or undefined when it holds
 * none. Takes several record sets because "the CRM was recording" is proven by
 * whichever of them starts earliest.
 *
 * Pass the UNFILTERED sets. This is a fact about the account, not about the
 * active window, and deriving it from a filtered slice would make it drift with
 * the date picker — the clip below would then chase its own tail.
 */
export function firstRecordedDay(
  ...sets: Array<ReadonlyArray<{ createdAt?: string }> | undefined>
): string | undefined {
  let first: string | undefined
  for (const set of sets) {
    if (!set) continue
    for (const r of set) {
      const day = (r.createdAt ?? "").slice(0, 10)
      if (!day) continue
      if (first === undefined || day < first) first = day
    }
  }
  return first
}

/**
 * The window the ad numbers actually cover: the active date filter clipped to
 * the days we fetched from Meta AND to the days the CRM was recording.
 *
 * This clipping is the point, and it cuts in both directions:
 *
 * - Spend is fetched over a bounded trailing window while the CRM can go back to
 *   the account's first day, so on "Todo el historial" a naive CPL would divide
 *   a year of spend by five years of leads and report a third of the real cost.
 * - The reverse is just as common and was hiding in plain sight: a sub-account
 *   opened AFTER the ad account was already spending. stanza-residencial holds
 *   spend from 2026-03-02 but its first contact is 2026-07-15, so an unclipped
 *   CPL divided five months of spend by two months of leads — 214.96 against a
 *   true 50.98. amir-cherit has the same shape, milder (228.65 → 218.02).
 *
 * `crmFrom` is that second bound, from firstRecordedDay(). Only days no record
 * could possibly exist for are removed: a zero after the CRM was already
 * recording is a real zero and stays in, the same way an unlinked pauta is never
 * priced at zero.
 *
 * Returns null when the filter and the fetched window don't overlap at all.
 */
export function adsWindow(
  report: AdsReport | undefined,
  range: ResolvedDateRange | null,
  crmFrom?: string
): { from: string; to: string } | null {
  if (!report?.from || !report?.to) return null
  let from = range ? maxDay(report.from, toDayKey(range.from)) : report.from
  if (crmFrom) from = maxDay(from, crmFrom)
  const to = range ? minDay(report.to, toDayKey(range.to)) : report.to
  return from <= to ? { from, to } : null
}

// YYYY-MM-DD sorts lexicographically, so string comparison is date comparison.
const maxDay = (a: string, b: string) => (a >= b ? a : b)
const minDay = (a: string, b: string) => (a <= b ? a : b)

/**
 * True when part of the window predates the first day the Pauta object ever
 * recorded a lead, so a campaign's zero cannot be told apart from "nothing was
 * recording yet".
 *
 * Three different facts arrive at the same rendered `0` in the leads column:
 * the campaign produced nothing, no pauta could be written yet, or it is a
 * traffic-objective campaign that never produces a form at all. Only the first
 * is an accusation against the campaign. amir-cherit shows 85 of 188 campaigns
 * at zero — 34% of all clicks — and nearly all of them ran before its Pauta
 * object's first record (2026-03-01); "Casa Tabachines" has 3 099 clicks whose
 * one ad id appears in none of the 3 764 pautas, of any date.
 *
 * Per-campaign precision is not available — ad rows come back aggregated for
 * the window, with no dates — so this is an account-level fact, applied to the
 * zero rows only. When the user picks a window that sits entirely inside the
 * pauta era it goes false and a zero means zero again.
 */
export function hasUnobservableLeadDays(
  window: { from: string; to: string } | null,
  attributionFrom: string | undefined
): boolean {
  if (!window) return false
  // No pauta has ever been recorded: nothing in any window is observable.
  if (!attributionFrom) return true
  return window.from < attributionFrom
}

/** The daily rows inside a window, inclusive on both ends. */
export function daysInWindow(days: AdDay[], window: { from: string; to: string } | null): AdDay[] {
  if (!window) return []
  return days.filter((d) => d.date >= window.from && d.date <= window.to)
}

/**
 * True when the active filter reaches further back than the window the ad KPIs
 * actually describe — because Meta stops at 365 days, because the CRM had not
 * started yet, or both. The UI says so out loud; a silently narrower window is
 * exactly how a CPL ends up looking three times better than it is.
 */
export function isWindowClipped(
  report: AdsReport | undefined,
  range: ResolvedDateRange | null,
  crmFrom?: string
): boolean {
  if (!report?.from) return false
  if (!range) return true
  const asked = toDayKey(range.from)
  return asked < report.from || (!!crmFrom && asked < crmFrom)
}

// ---------------------------------------------------------------------------
// Joining Meta spend to the CRM, by ad id
// ---------------------------------------------------------------------------
//
// The ONLY reliable key between Meta and this CRM is the ad id. Verified on
// stanza-residencial: the Pauta object stores it in `id_de_pauta`
// ("120251969488650130"), an opportunity carries the same value in `adId`
// (from `utmAdId`), and Meta's `listType=ads` rows are keyed by it.
//
// A NAME join would silently produce garbage — the same ad is
// "Mazatlán si puede ser tuyo_imagen" in Meta and "Casas en Mazatlán desde
// $1.29 MDP" in the Pauta record. Never match these on names.

/**
 * The ad id a Pauta record was captured from, or undefined.
 *
 * Matched loosely on the property key, like every other pauta property helper:
 * spelling varies per sub-account and the Make scenario has shipped typos
 * before (see `pautaContactPhone`). Requires "id" and "pauta" in the key so it
 * cannot pick up `telefono_contacto` or `registro`.
 */
export function pautaAdId(p: Pauta): string | undefined {
  if (!p.properties) return undefined
  for (const [k, v] of Object.entries(p.properties)) {
    const key = k.toLowerCase()
    if (!key.includes("id") || !key.includes("pauta")) continue
    const s = String(v ?? "").trim()
    // "-" is the Make scenario's placeholder for "no value".
    if (s && s !== "-") return s
  }
  return undefined
}

export interface AdJoin {
  /** Ad id → how many pautas Meta's linked ad account can account for. */
  leadsByAdId: Map<string, number>
  /** Pautas whose ad id matched an ad in the linked account. */
  matched: number
  /**
   * Pautas we could NOT price. Two different reasons, kept apart because they
   * mean different things to the reader — see `unlinkedAccount`.
   */
  unmatched: number
  /**
   * Of `unmatched`, those whose Pauta carries a real ad id that simply is not in
   * the linked ad account. On stanza-residencial this is the majority: the
   * sub-account runs ads across 14 Meta ad accounts and GHL can only link one,
   * so most leads have spend that this endpoint will never return. Surfacing the
   * count is the difference between "these leads were free" and "we cannot see
   * what these cost".
   */
  unlinkedAccount: number
  /** Pautas with no ad id at all on the record. */
  noAdId: number
}

/**
 * Count pautas per Meta ad id. `adIds` is the set of ads the linked account
 * reported for the window, used only to tell the two unmatched reasons apart.
 */
export function joinPautasToAds(pautas: Pauta[], adIds: Set<string>): AdJoin {
  const leadsByAdId = new Map<string, number>()
  let matched = 0
  let unlinkedAccount = 0
  let noAdId = 0

  for (const p of pautas) {
    const adId = pautaAdId(p)
    if (!adId) {
      noAdId++
      continue
    }
    if (!adIds.has(adId)) {
      unlinkedAccount++
      continue
    }
    leadsByAdId.set(adId, (leadsByAdId.get(adId) ?? 0) + 1)
    matched++
  }

  return { leadsByAdId, matched, unmatched: unlinkedAccount + noAdId, unlinkedAccount, noAdId }
}

/**
 * Total spend for a set of ad ids, counting each ad ONCE.
 *
 * The dedupe matters: callers pass the ad ids behind a group of pautas, and a
 * group holds many pautas per ad. Summing per pauta would multiply an ad's
 * spend by its own lead count — inflating cost exactly where it is read as
 * cost per lead.
 */
export function spendForAdIds(adIds: Iterable<string>, adsById: Map<string, AdStat>): number {
  let total = 0
  const seen = new Set<string>()
  for (const id of adIds) {
    if (seen.has(id)) continue
    seen.add(id)
    total += adsById.get(id)?.spend ?? 0
  }
  return total
}

/**
 * Roll ad rows up to campaigns, attaching the CRM's own lead count.
 *
 * Replaces GHL's CDP attribution for the Leads column: on stanza-residencial the
 * CDP returned 0 for every campaign — matching GHL's own Meta Ads report, so not
 * a bug on either side, just an empty feature — while this join yields real
 * counts from data the dashboard already trusts everywhere else.
 */
export function campaignsFromAds(
  ads: AdStat[],
  leadsByAdId: Map<string, number>
): AdCampaignStat[] {
  const byCampaign = new Map<string, AdCampaignStat>()
  for (const ad of ads) {
    const prev = byCampaign.get(ad.campaignId)
    const leads = leadsByAdId.get(ad.adId) ?? 0
    if (!prev) {
      byCampaign.set(ad.campaignId, {
        id: ad.campaignId,
        name: ad.campaignName,
        status: ad.campaignStatus,
        spend: ad.spend,
        impressions: ad.impressions,
        clicks: ad.clicks,
        leads,
      })
      continue
    }
    prev.spend += ad.spend
    prev.impressions += ad.impressions
    prev.clicks += ad.clicks
    prev.leads += leads
  }
  // Campaigns that did not deliver at all in this window are dropped rather
  // than listed as a row of zeros. GHL returns the account's whole campaign
  // list whatever the window is — amir-cherit answers with the same 194 ads for
  // 30 days as for 365, only the metrics move — so without this the table is
  // mostly empty rows that look like failures instead of absences.
  return Array.from(byCampaign.values())
    .filter((c) => c.spend > 0 || c.clicks > 0 || c.impressions > 0)
    .sort((a, b) => b.spend - a.spend)
}
