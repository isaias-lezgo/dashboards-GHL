// Meta ad spend for the AI panel. Every rule here is lib/ads.ts's, applied the
// way components/dashboard/ads-section.tsx applies it — the panel must report
// the same spend and the same cost per lead as the hand-built block:
//
// - the window is the requested range clipped to the days Meta returned AND to
//   the days the CRM was recording (firstRecordedDay over the UNFILTERED sets);
// - the CPL denominator is the CRM's own de-pauta opportunities created inside
//   that window — never Meta's lead count, never pipeline- or filter-scoped
//   (Meta has no pipeline, advisor or stage: filtering only the denominator
//   inflates the cost per lead);
// - "not connected" and "not looked yet" are states, not zeros.
import type { AdDay, AdsStatus } from "@/lib/types";
import type { ResolvedDateRange } from "@/lib/date-range";
import { adsWindow, daysInWindow, firstRecordedDay, isWindowClipped } from "@/lib/ads";
import { isDePauta } from "@/lib/pauta";
import type { ResolvedCtx } from "./semantic";

export interface AdsRows {
  rows: AdDay[];
  window: { from: string; to: string } | null;
  status: AdsStatus | "pending";
  message: string | null;
  /** The window ended up shorter than the requested range — the card must say so. */
  clipped: boolean;
}

export function adsRowsFor(ctx: ResolvedCtx, range: ResolvedDateRange | null): AdsRows {
  const ads = ctx.ads;
  // A payload cached before ad spend shipped has no `ads` at all: "we have not
  // looked yet", which is not the same claim as "not connected".
  if (!ads) return { rows: [], window: null, status: "pending", message: null, clipped: false };
  if (ads.status !== "connected") {
    return { rows: [], window: null, status: ads.status, message: ads.message ?? null, clipped: false };
  }
  const crmFrom = firstRecordedDay(ctx.dataset.contacts, ctx.dataset.opportunities);
  const window = adsWindow(ads, range, crmFrom);
  return {
    rows: daysInWindow(ads.daily, window),
    window,
    status: "connected",
    message: null,
    clipped: window !== null && isWindowClipped(ads, range, crmFrom),
  };
}

/**
 * Day keys (YYYY-MM-DD, as AdsSection slices them) of the de-pauta opportunities
 * created inside the window, sorted. isDePauta runs over the FULL pauta history
 * and the opportunities are not pipeline-filtered: the same denominator
 * AdsSection divides by.
 */
export function pautaLeadDays(ctx: ResolvedCtx, window: { from: string; to: string } | null): string[] {
  if (!window) return [];
  const out: string[] = [];
  for (const o of ctx.dataset.opportunities) {
    const day = (o.createdAt ?? "").slice(0, 10);
    if (!day || day < window.from || day > window.to) continue;
    if (isDePauta(o, ctx.pautaContactsAll)) out.push(day);
  }
  return out.sort();
}

export function clippedWarning(window: { from: string; to: string }): string {
  return `El gasto solo cubre del ${window.from} al ${window.to}; el CPL usa los leads de esos mismos días.`;
}
