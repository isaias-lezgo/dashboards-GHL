// Server-side assembly of the Meta ad-spend report: talk to /ad-publishing,
// classify what came back, normalize it into the internal AdDay / AdCampaignStat
// types. Runs inside the client's credential context (lib/ghl-context.ts), so it
// is only ever called from lib/sync.ts or an API route that established one.
//
// Everything here FAILS SOFT. Ad spend is a bonus panel on a dashboard whose
// real job is CRM data — if Meta, GHL or the token is having a bad day, the
// section explains itself and the other twenty charts still render. Nothing in
// this file is allowed to throw into syncProject.
import {
  getFacebookAdAccount,
  getFacebookAdReporting,
  getFacebookReportingList,
  type GHLFacebookReportingRow,
} from "@/lib/ghl-client"
import { num, metaLeadsFrom, conversationsFrom, emptyAdsReport } from "@/lib/ads"
import type { AdDay, AdsReport, AdsStatus, AdStat } from "@/lib/types"

/**
 * How far back the daily series reaches. Covers every date-filter preset up to
 * "6m" with room to spare; a longer custom range is clipped and the UI says so
 * (see isWindowClipped in lib/ads.ts).
 *
 * Not larger, because the window costs one request per 25 days — see below.
 */
export const ADS_WINDOW_DAYS = 365

/**
 * The reporting endpoint caps `grouped` at 25 rows and SILENTLY truncates past
 * it: a 365-day groupBy=day query returns the first 25 days and a `totals` that
 * covers only those, with nothing in the response marking it short. Verified on
 * a live account — a year of daily data came back as 25 rows, and a year of
 * weekly data came back as 25 weeks ending in March.
 *
 * So the window is split into 25-day chunks and reassembled here. Daily
 * granularity is worth the extra requests: it is what lets the browser re-sum
 * spend over whatever window the date filter picks, instead of pinning the whole
 * section to one fixed period that would disagree with every other number.
 *
 * NEVER widen a single request past this and never read `totals` — both fail
 * quietly, which is the worst way for a money number to be wrong.
 */
const MAX_GROUPED_ROWS = 25

/**
 * Ceiling on the per-campaign ad fan-out. One request each, and the route has a
 * wall clock; beyond this the table stops being worth the wait. Never bites
 * today (the largest roster account lists 91).
 */
const MAX_CAMPAIGNS_FANNED_OUT = 200

const DAY_MS = 86_400_000

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Inclusive [from, to] slices of at most MAX_GROUPED_ROWS days each. */
function chunkDays(from: Date, to: Date): Array<{ startDate: string; endDate: string }> {
  const chunks: Array<{ startDate: string; endDate: string }> = []
  let cursor = from.getTime()
  const end = to.getTime()
  while (cursor <= end) {
    const chunkEnd = Math.min(cursor + (MAX_GROUPED_ROWS - 1) * DAY_MS, end)
    chunks.push({ startDate: dayKey(new Date(cursor)), endDate: dayKey(new Date(chunkEnd)) })
    cursor = chunkEnd + DAY_MS
  }
  return chunks
}

/**
 * Map a thrown ghlFetch error onto an AdsStatus. ghlFetch throws
 * `GHL API Error: <status> - <raw body>`, so both the code and the message are
 * in the string. Every branch here was observed against a live sub-account.
 */
function classifyError(err: unknown): { status: AdsStatus; message: string } {
  const raw = err instanceof Error ? err.message : String(err)

  if (/\b40[13]\b/.test(raw) || /scope/i.test(raw)) {
    return {
      status: "unauthorized",
      message:
        "El token de esta cuenta no tiene el permiso adPublishing.readonly. Se activa en GHL → Ajustes → Integraciones privadas.",
    }
  }
  // "Access Token not found or it could not be fetched" — the integration row
  // exists but Meta revoked or expired the authorization.
  if (/access token not found/i.test(raw)) {
    return {
      status: "expired",
      message:
        "La conexión con Meta expiró o fue revocada. El cliente debe volver a autorizar Facebook en GHL.",
    }
  }
  // "Ad Account not found for location X" / "Integrations for location X does not exist"
  if (/ad account not found/i.test(raw) || /does not exist/i.test(raw) || /\b404\b/.test(raw)) {
    return {
      status: "disconnected",
      message: "Esta subcuenta no tiene una cuenta publicitaria de Meta vinculada en GHL.",
    }
  }
  return {
    status: "error",
    message: "No se pudo leer el reporte de Meta. Vuelve a intentarlo más tarde.",
  }
}

/** GHL sends metrics as strings and omits days with no delivery. */
function toAdDay(row: GHLFacebookReportingRow): AdDay | null {
  // groupBy=day makes dateStart the day itself. No date means nothing we can
  // place on a timeline, so the row is useless to us.
  const date = (row.dateStart ?? "").slice(0, 10)
  if (!date) return null
  return {
    date,
    spend: num(row.spend),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    reach: num(row.reach),
    metaLeads: metaLeadsFrom(row.conversions, row.results),
    conversations: conversationsFrom(row.results),
  }
}

/**
 * The account-level daily series for the trailing ADS_WINDOW_DAYS.
 *
 * The REPORTING call is the gate, not the integration record.
 *
 * `/ad-publishing/facebook/integration` describes GHL's Ad Manager *publishing*
 * setup — connected pages, the default page, whether campaigns can be created
 * from inside GHL. Reporting works off the linked ad account and is INDEPENDENT
 * of it. An earlier version checked the integration first and refused to go on
 * without it, which hid a perfectly working ad account behind a "not connected"
 * banner: sahai returns 404 "Integrations for location … does not exist" from
 * that endpoint while its reporting returns 16 days and MXN 21,755.49, matching
 * GHL's own Meta Ads report to the cent. Never gate on the integration again.
 *
 * The ad account id is read off the reporting rows themselves (`accountId`), so
 * nothing else has to resolve it.
 */
export async function fetchAdsReport(
  onProgress?: (days: number) => void
): Promise<AdsReport> {
  const to = new Date()
  const from = new Date(to.getTime() - (ADS_WINDOW_DAYS - 1) * DAY_MS)
  const [probe, ...rest] = chunkDays(from, to)

  // The first chunk is fetched alone as a probe. A sub-account with no linked ad
  // account is the common case, and fanning all ~15 chunks out at it would burn
  // 15 requests per sync to learn one thing. A failure here is a status; a
  // failure in any later chunk is just a hole in the series.
  let probeRows: GHLFacebookReportingRow[]
  try {
    const res = await getFacebookAdReporting({ ...probe, groupBy: "day" })
    probeRows = res?.grouped ?? []
  } catch (err) {
    const classified = classifyError(err)
    console.warn(`[GHL] Ad reporting unavailable: ${classified.status}`)
    return emptyAdsReport(classified.status, classified.message)
  }

  let seenDays = probeRows.length
  onProgress?.(seenDays)

  const restResults = await Promise.all(
    rest.map((chunk) =>
      getFacebookAdReporting({ ...chunk, groupBy: "day" })
        .then((res) => {
          const rows = res?.grouped ?? []
          seenDays += rows.length
          onProgress?.(seenDays)
          return rows
        })
        .catch((err: unknown) => {
          // One bad chunk must not blank the year — the connection already
          // proved itself on the probe, so this is a gap, not a status.
          console.error(`[GHL] Ad reporting chunk ${chunk.startDate}..${chunk.endDate} failed:`, err)
          return [] as GHLFacebookReportingRow[]
        })
    )
  )

  const allRows = [probeRows, ...restResults].flat()

  // Dedupe by date (chunks are disjoint, but a boundary day appearing twice
  // would double-count spend — the one error here nobody would ever notice).
  const byDate = new Map<string, AdDay>()
  for (const row of allRows) {
    const day = toAdDay(row)
    if (day) byDate.set(day.date, day)
  }
  const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))

  // Straight off the reporting rows, so no separate lookup can disagree with
  // the numbers it labels.
  const adAccountId = allRows.find((r) => r.accountId)?.accountId as string | undefined

  // Name and currency are a nicety: without them the UI prints bare amounts
  // rather than mislabeling MXN as USD.
  const account = adAccountId
    ? await getFacebookAdAccount(adAccountId).catch((err: unknown) => {
        console.warn("[GHL] Ad account details fetch failed:", err)
        return undefined
      })
    : undefined

  return {
    status: "connected",
    adAccountId,
    adAccountName: typeof account?.name === "string" ? account.name : undefined,
    currency: typeof account?.currency === "string" ? account.currency : undefined,
    from: dayKey(from),
    to: dayKey(to),
    daily,
  }
}

/**
 * Per-AD metrics for an explicit window.
 *
 * The ad, not the campaign, because the ad id is the only key that reaches the
 * CRM: the Pauta object stores it in `id_de_pauta` and an opportunity carries it
 * as `adId`. Campaign rows are rolled up from these in the pure layer, so the
 * same fetch serves both the campaign table and the per-pauta cost.
 *
 * Two levels of calls, because of an undocumented asymmetry verified live: with
 * type=INTEGRATION (an ad account run in Meta rather than built in GHL's Ad
 * Manager), `listType=campaigns` returns campaigns with NO metrics — just name,
 * status and id. The ad rows DO carry spend. So we list the campaigns and then
 * ask for each one's ads.
 *
 * That makes this N+1 in the number of campaigns, which is why it lives behind
 * an on-demand route instead of the main sync.
 *
 * COVERAGE CAVEAT: this only ever sees the ONE ad account GHL has linked. A
 * sub-account whose ads run across several Meta ad accounts (stanza-residencial
 * has 14) will have leads whose spend simply is not here. The join reports those
 * separately rather than pricing them at zero — see `joinPautasToAds`.
 */
export async function fetchAdBreakdown(
  startDate: string,
  endDate: string
): Promise<{ status: AdsStatus; message?: string; ads: AdStat[] }> {
  let campaignList: Array<{ id: string; name: string; status: string }>
  try {
    const rows = await getFacebookReportingList({ listType: "campaigns", startDate, endDate })
    campaignList = rows
      .map((r) => ({
        id: String(r.campaignId ?? ""),
        name: String(r.name ?? "Sin nombre"),
        status: String(r.status ?? ""),
      }))
      .filter((c) => c.id)
  } catch (err) {
    const classified = classifyError(err)
    return { status: classified.status, message: classified.message, ads: [] }
  }

  if (campaignList.length === 0) return { status: "connected", ads: [] }

  // One request per campaign, so a long-lived account is a long fan-out — sahai
  // lists 91. The cap is a timeout guard, not a product decision: the
  // account-level KPIs above the table already carry the complete spend, and
  // this table only ranks. `listType=campaigns` returns no metrics under
  // INTEGRATION, so there is nothing to rank by before fetching; GHL lists them
  // newest-first, which is the useful end to keep.
  const capped = campaignList.slice(0, MAX_CAMPAIGNS_FANNED_OUT)

  const perCampaign = await Promise.all(
    capped.map((campaign) =>
      getFacebookReportingList({
        listType: "ads",
        campaignId: campaign.id,
        startDate,
        endDate,
      })
        .then((ads) =>
          ads
            .filter((a) => a.adId)
            .map(
              (a): AdStat => ({
                adId: String(a.adId),
                adName: String(a.name ?? "Sin nombre"),
                campaignId: campaign.id,
                campaignName: campaign.name,
                campaignStatus: campaign.status,
                spend: num(a.spend),
                impressions: num(a.impressions),
                clicks: num(a.clicks),
              })
            )
        )
        .catch((err: unknown) => {
          // One campaign's ads failing must not drop the other eight. The
          // campaign then contributes no ads, which the coverage line accounts
          // for — better than inventing a zero-spend row that reads as "free".
          console.error(`[GHL] Ads for campaign ${campaign.id} failed:`, err)
          return [] as AdStat[]
        })
    )
  )

  return { status: "connected", ads: perCampaign.flat() }
}
