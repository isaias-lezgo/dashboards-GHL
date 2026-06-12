// Canonical "Origen de lead" platform normalization, shared by the
// Marketing and Ventas dashboards so both tabs bucket sources identically.
import type { Opportunity } from "./types"

export const PLATFORM_COLORS: Record<string, string> = {
  "Instagram":  "#E1306C",
  "Facebook":   "#1877F2",
  "TikTok":     "#010101",
  "Google":     "#EA4335",
  "WhatsApp":   "#25D366",
  "Otro":       "#6b7280",
}

export const PLATFORM_ORDER = ["Instagram", "Facebook", "TikTok", "Google", "WhatsApp", "Otro"]

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
  const med = (opp.attributionMedium ?? "").toLowerCase()
  if (med === "whatsapp" || (opp.contact?.tags ?? []).some((t) => t.toLowerCase().includes("inbound whatsapp"))) return "WhatsApp"
  return "Otro"
}
