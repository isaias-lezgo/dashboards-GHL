// Canonical "Origen de lead" platform normalization, shared by the
// Marketing and Ventas dashboards so both tabs bucket sources identically.
import type { Opportunity } from "./types"

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
  //   2. attributionMedium  — GHL-internal medium (facebook, instagram, tiktok…)
  //   3. adType             — utmMedium / utmSessionSource
  //   4. campaign           — built from utmContent / utmCampaign
  //   5. attributionUrl/src — re-scan the full strings for non-".com" forms
  for (const raw of [
    opp.originPlatform,
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

  // Nothing matched anywhere — only now is it genuinely "Otro".
  return "Otro"
}
