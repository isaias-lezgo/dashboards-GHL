// app/api/oauth/webhook/route.ts
// GHL's app webhooks: INSTALL and UNINSTALL. Installing the app on a
// sub-account turns its dashboard on; uninstalling turns it off
// (lib/installations.ts). Every other event type is acknowledged and ignored.
//
// Excluded from middleware (it lives under /api/oauth). Authenticity comes from
// the Ed25519 signature in X-GHL-Signature, checked against GHL's published key
// before the body is trusted. The legacy RSA X-WH-Signature was retired by GHL
// on 2026-09-01 and is not accepted.
//
// INSTALL does not trust the payload's location: it re-reads GHL's installed
// list, which is idempotent and cannot be steered. UNINSTALL acts on the
// payload — waiting for GHL's list to catch up could leave an uninstalled
// sub-account's dashboard on — which is why the signature is mandatory.
import { NextResponse } from "next/server";
import { verifyGhlWebhook } from "@/lib/ghl-webhook";
import { getClients, invalidateRosterCache } from "@/lib/clients";
import { markCompanyUninstalled, markUninstalled, reconcileInstallations } from "@/lib/installations";
import { getAppConfig } from "@/lib/ghl-oauth";
import { AGENCY_COMPANY_ID } from "@/lib/ghl-sso";

export const runtime = "nodejs";

interface AppEvent {
  type?: string;
  appId?: string;
  companyId?: string;
  locationId?: string;
}

// GHL's portal refuses to save a webhook URL that does not answer 2xx to its
// probe ("WebhookURL must be valid"). The probe is unsigned, so GET/HEAD and
// unsigned POSTs are acknowledged with 200 — and act on nothing: only a body
// that passes the signature check ever reaches the handlers below.
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyGhlWebhook(raw, req.headers.get("x-ghl-signature"))) {
    console.warn("[webhook] ignored: bad or missing X-GHL-Signature");
    return NextResponse.json({ ok: true, ignored: "unsigned" });
  }

  let event: AppEvent;
  try {
    event = JSON.parse(raw) as AppEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Other apps' events, or another agency's, are none of our business.
  if (event.appId && event.appId !== getAppConfig().appId) return NextResponse.json({ ok: true, ignored: "app" });
  if (event.companyId && event.companyId !== AGENCY_COMPANY_ID) return NextResponse.json({ ok: true, ignored: "company" });

  try {
    if (event.type === "INSTALL") {
      const result = await reconcileInstallations(process.env.DASHBOARD_CLIENTS ? getClients() : []);
      invalidateRosterCache();
      console.log("[webhook] INSTALL → reconciled", result);
      return NextResponse.json({ ok: true, ...result });
    }
    if (event.type === "UNINSTALL") {
      if (event.locationId) await markUninstalled(event.locationId);
      else if (event.companyId) await markCompanyUninstalled(event.companyId);
      invalidateRosterCache();
      console.log("[webhook] UNINSTALL", event.locationId ? `location ${event.locationId}` : `company ${event.companyId}`);
      return NextResponse.json({ ok: true });
    }
  } catch (err) {
    console.error(`[webhook] ${event.type} failed:`, err);
    // 5xx so GHL retries.
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ignored: event.type ?? "unknown" });
}
