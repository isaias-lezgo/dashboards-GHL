// app/api/auth/sso/route.ts
// Login from inside GHL. app/embed/page.tsx obtains the encrypted user context
// from the parent frame and posts it here; we decrypt it with the app's Shared
// Secret, map the sub-account to a roster client, and issue the same signed
// dash_session cookie the password login does.
//
// The cookie differs in one way: the dashboard runs inside GHL's iframe, where
// it is a THIRD-PARTY cookie. SameSite=Lax would never be sent back, so it goes
// out SameSite=None + Partitioned (CHIPS) — scoped to the GHL top-level site,
// which also keeps it from leaking into a direct visit to the dashboard.
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signToken } from "@/lib/auth";
import { resolveClientByLocationId } from "@/lib/clients";
import { decideSso, decryptUserContext } from "@/lib/ghl-sso";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const key = process.env.GHL_APP_SSO_KEY;
  if (!key || !process.env.DASHBOARD_AUTH_SECRET) {
    console.error("[sso] GHL_APP_SSO_KEY or DASHBOARD_AUTH_SECRET not set");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let encrypted = "";
  try {
    encrypted = ((await req.json()) as { encryptedData?: string }).encryptedData ?? "";
  } catch {
    // fall through to the empty check
  }
  if (!encrypted) return NextResponse.json({ error: "missing_payload" }, { status: 400 });

  let ctx;
  try {
    ctx = decryptUserContext(encrypted, key);
  } catch (err) {
    console.warn("[sso] rejected payload:", String(err));
    return NextResponse.json({ error: "invalid_payload" }, { status: 401 });
  }
  const decision = decideSso(ctx);
  if (!decision.ok) {
    // Shape only, no name or email: enough to see what GHL actually sends.
    console.warn("[sso] refused:", decision.reason, {
      type: ctx.type,
      role: ctx.role,
      hasActiveLocation: Boolean(ctx.activeLocation),
      companyMatches: decision.reason !== "wrong_agency",
    });
    return NextResponse.json({ error: decision.reason }, { status: 403 });
  }

  let client;
  try {
    client = await resolveClientByLocationId(decision.locationId);
  } catch (err) {
    console.error("[sso] Invalid DASHBOARD_CLIENTS:", err);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: "no_dashboard" }, { status: 404 });
  }

  const token = await signToken(client.id, Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    partitioned: true,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
