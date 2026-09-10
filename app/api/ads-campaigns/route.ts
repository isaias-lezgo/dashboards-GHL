// Per-campaign Meta spend for an explicit window.
//
// Deliberately NOT part of the main sync payload, for two reasons:
//   1. It is N+1 in the number of campaigns (see fetchAdCampaigns) — too slow to
//      sit on the critical path of the first render.
//   2. It cannot be re-filtered in the browser. The account-level series is
//      daily, so the client can re-sum it over any window; campaign rows come
//      back pre-aggregated for whatever window was asked for. Caching one fixed
//      window and showing it next to a date filter that says something else is
//      exactly the kind of quiet disagreement this dashboard avoids — so the
//      window is a parameter and the table refetches when the filter moves.
import { NextResponse } from "next/server";
import { requireClient, unauthorized } from "@/lib/session";
import { withClient } from "@/lib/ghl-context";
import { fetchAdBreakdown } from "@/lib/ads-sync";

export const runtime = "nodejs";
// The ad fan-out is one request per campaign and an account can list ~100
// (sahai: 91), so this needs the same ceiling as the main sync. Requires Fluid
// Compute, which this project already depends on — see the sync-cache notes.
export const maxDuration = 300;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const client = await requireClient();
  if (!client) return unauthorized();

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  // Validated rather than passed through: these land in a query string sent to
  // GHL, and a malformed date comes back as an opaque 422 much later.
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) {
    return NextResponse.json({ error: "Invalid from/to (expected YYYY-MM-DD)" }, { status: 400 });
  }

  return withClient(client, async () => {
    try {
      const result = await fetchAdBreakdown(from, to);
      return NextResponse.json(result);
    } catch (err) {
      console.error("[/api/ads-campaigns]", err);
      return NextResponse.json(
        { status: "error", message: "No se pudo leer el reporte por campaña.", ads: [] },
        { status: 502 }
      );
    }
  });
}
