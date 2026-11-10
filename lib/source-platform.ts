// Canonical "Origen de lead" platform normalization, shared by the
// Marketing and Ventas dashboards so both tabs bucket sources identically.
import type { Opportunity } from "./types"
import { PAID_SEARCH_MEDIUMS, PAID_SEARCH_SOURCES, PAID_SOCIAL_MEDIUMS, PAID_SOCIAL_SOURCES } from "./pauta"

export const PLATFORM_COLORS: Record<string, string> = {
  "Instagram":  "#E1306C",
  "Facebook":   "#1877F2",
  "TikTok":     "#010101",
  "Google":     "#EA4335",
  "Otro":       "#6b7280",
}

export const PLATFORM_ORDER = ["Instagram", "Facebook", "TikTok", "Google", "Otro"]

// Classify a single free-text origin hint into a platform bucket, or null if it
// carries no platform signal. WhatsApp is deliberately absent: it is a contact
// channel, not a lead origin, so a bare "whatsapp" never promotes out of "Otro".
function classifyHint(h: string): string | null {
  if (h.includes("instagram") || /\big\b/.test(h)) return "Instagram"
  if (
    h.includes("facebook") || h.includes("messenger") || h.includes("meta") ||
    /\bfb\b/.test(h)
  ) return "Facebook"
  if (h.includes("tiktok") || h.includes("tik tok")) return "TikTok"
  if (
    h.includes("google") || h.includes("bing") || h.includes("yahoo") ||
    h.includes("adwords") || h.includes("gclid")
  ) return "Google"
  return null
}

// Opportunity custom fields that can carry an explicit origin / ad-type signal.
// Field NAMES vary across GHL sub-accounts ("Origen de Lead" vs "Origen del
// Lead", "Tipo de pauta" vs "Tipo de anuncio"…), so match loosely by substring.
const ORIGIN_FIELD_HINTS = [
  "origen",          // Origen de Lead / Origen del Lead / Origen
  "tipo de pauta",   // Tipo de pauta (Google Ads / Formulario / …)
  "tipo de anuncio",
  "nombre pauta",    // Nombre pauta (sometimes literally "Google Ads")
  "nombre de pauta",
]

// Concatenated, lowercased text of every origin/ad-type custom field on an
// opportunity. Website leads pushed in via Zapier lose their UTM platform, but
// the CRM still records e.g. Origen de Lead = "Sitio Web Inicio" and Tipo de
// pauta = "Google Ads" — so this is often the only surviving platform signal.
export function originSignalText(opp: Opportunity): string {
  const resolved = opp.customFieldsResolved
  if (!resolved) return ""
  const parts: string[] = []
  for (const [name, val] of Object.entries(resolved)) {
    const n = name.toLowerCase()
    if (!ORIGIN_FIELD_HINTS.some((h) => n.includes(h))) continue
    const s = Array.isArray(val) ? val.join(" ") : String(val ?? "")
    if (s.trim()) parts.push(s)
  }
  return parts.join(" ").toLowerCase()
}

// Tolerant Google-Ads / paid-search detector for the origin-signal text above.
// Clients label the pauta differently ("Google Ads", "Google", "Adwords",
// "Google Ads Search"…), so accept any of these forms.
export function hasGoogleAdsSignal(text: string): boolean {
  return (
    text.includes("google ad") ||  // "google ads", "google adwords"
    text.includes("adwords") ||
    text.includes("gclid") ||
    /\bgoogle\b/.test(text)
  )
}

// Website / landing-page origin signal. The picklist value varies by client
// ("Sitio Web Inicio", "Sitio Web", "Página Web", "Web", "Landing", "Website"…).
export function hasWebsiteSignal(text: string): boolean {
  return (
    text.includes("sitio web") || text.includes("pagina web") ||
    text.includes("página web") || text.includes("website") ||
    text.includes("landing") || /\bweb\b/.test(text)
  )
}

export function platformLabel(opp: Opportunity): string {
  const url  = (opp.attributionUrl ?? "").toLowerCase()
  const src  = (opp.source ?? "").toLowerCase()
  if (url.includes("instagram.com") || src.includes("instagram")) return "Instagram"
  if (
    url.includes("fb.me") || url.includes("facebook.com") || url.includes("fb.com") ||
    src.includes("facebook") || src.includes("meta") || src === "fb" ||
    /^\d{10,}$/.test(opp.source ?? "")
  ) return "Facebook"
  if (src.includes("tiktok")) return "TikTok"
  if (src.includes("google") || src.includes("bing") || src.includes("yahoo")) return "Google"

  // Fallback cascade — the primary signals above (attribution URL / source) are
  // frequently empty for ad/organic-social leads even though GHL knows the
  // origin. Probe every remaining hint, strongest → weakest, before giving up:
  //   1. originPlatform     — contact's explicit "Origen de Lead" custom field
  //   2. originSignalText   — opportunity custom fields (Origen de Lead / Tipo
  //                           de pauta / Nombre pauta) — e.g. a website lead
  //                           pushed via Zapier whose Tipo de pauta = "Google Ads"
  //                           folds into Google here.
  //   3. attributionMedium  — GHL-internal medium (facebook, instagram, tiktok…)
  //   4. adType             — utmMedium / utmSessionSource
  //   5. campaign           — built from utmContent / utmCampaign
  //   6. attributionUrl/src — re-scan the full strings for non-".com" forms
  for (const raw of [
    opp.originPlatform,
    originSignalText(opp),
    opp.attributionMedium,
    opp.adType,
    opp.campaign,
    opp.attributionUrl,
    opp.source,
  ]) {
    if (!raw) continue
    const hit = classifyHint(String(raw).toLowerCase())
    if (hit) return hit
  }

  // Note: a website-origin lead WITH a Google Ads pauta already resolved to
  // "Google" above (the cascade sees "google ads" in originSignalText). A purely
  // organic website lead carries no platform signal, so it stays "Otro" on the
  // platform axis — the Marketing dashboard distinguishes it as "Orgánico Web" in
  // the fuente segment via hasWebsiteSignal().
  return "Otro"
}

// ─── Source category ("Oportunidades por fuente") ─────────────────────────────
// Moved here from the Marketing dashboard so the AI panel engine buckets
// opportunities exactly like the hand-built chart does — one implementation,
// not two that drift.

const SOCIAL_ORGANIC_SOURCES = ["instagram", "facebook", "twitter", "linkedin", "youtube", "tiktok", "pinterest", "social_media", "social media", "organic_social"]

export const SOURCE_CATEGORY_ORDER = ["Paid Social", "Paid Search", "Social Media", "CRM UI", "Orgánico Web", "Otro"]
export const SOURCE_CATEGORY_COLORS: Record<string, string> = {
  "Paid Social":   "#3b82f6",
  "Paid Search":   "#0891b2",
  "Social Media":  "#8b5cf6",
  "CRM UI":        "#f59e0b",
  "Orgánico Web":  "#10b981",
  "Otro":          "#6b7280",
}

// Friendly, Spanish display names for the source categories. The keys above stay
// as the internal data-key/identity (they're generated by sourceCategory() and
// used as Recharts dataKeys); this map is applied only at render time so charts,
// legends, tooltips and drill titles read plainly for non-marketers.
export const SOURCE_CATEGORY_LABELS: Record<string, string> = {
  "Paid Social": "Publicidad en Meta/TikTok",
  "Paid Search": "Publicidad en Google",
  "Social Media": "Redes Sociales (Orgánico)",
  "CRM UI": "Manual (CRM)",
}
export const catLabel = (cat: string): string => SOURCE_CATEGORY_LABELS[cat] ?? cat

// Manually-created leads carry the CRM-UI fingerprint in the attribution, NOT
// in `source`: GHL sets utmSessionSource="CRM UI" (→ adType) and medium="manual"
// (→ attributionMedium). Detect any of those so hand-entered leads land in the
// "CRM UI" bucket instead of falling through to "Otro".
const CRM_UI_VALUES = ["crm ui", "crm", "manual"]
function isCrmUi(src: string, med: string, attrMed: string): boolean {
  return (
    CRM_UI_VALUES.includes(src) ||
    CRM_UI_VALUES.includes(med) ||
    CRM_UI_VALUES.includes(attrMed)
  )
}

export function sourceCategory(opp: Opportunity): string {
  const src = (opp.source ?? "").toLowerCase()
  const med = (opp.adType ?? "").toLowerCase()
  const attrMed = (opp.attributionMedium ?? "").toLowerCase()
  // Website leads arrive without a UTM platform (pushed in via Zapier →
  // source/medium look like "Third Party"/"zapier"); the surviving signal lives
  // in the opportunity custom fields. Distinguish paid vs organic website:
  //   • "Tipo de pauta = Google Ads"            → Paid Search (paid website lead)
  //   • website "Origen de Lead" with NO pauta  → Orgánico Web (organic website lead)
  const originSignal = originSignalText(opp)
  if (hasGoogleAdsSignal(originSignal)) return "Paid Search"
  if (PAID_SOCIAL_SOURCES.some((s) => src.includes(s)) || PAID_SOCIAL_MEDIUMS.some((m) => med.includes(m))) return "Paid Social"
  if (PAID_SEARCH_SOURCES.some((s) => src.includes(s)) || PAID_SEARCH_MEDIUMS.some((m) => med.includes(m))) return "Paid Search"
  if (SOCIAL_ORGANIC_SOURCES.some((s) => src.includes(s)) || med.includes("social")) return "Social Media"
  // Organic website origin — checked before the empty-source CRM-UI catch below,
  // since these leads also have a blank source/medium.
  if (hasWebsiteSignal(originSignal)) return "Orgánico Web"
  if (src === "" || med === "" || isCrmUi(src, med, attrMed)) return "CRM UI"
  if (src.includes("web") || src.includes("website") || src.includes("landing") || med === "organic" || med === "referral") return "Orgánico Web"
  return "Otro"
}
