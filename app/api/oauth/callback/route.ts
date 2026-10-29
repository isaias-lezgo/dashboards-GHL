// app/api/oauth/callback/route.ts
// Where GHL sends the browser after the agency installs the Marketplace app.
// Exchanges the one-time ?code for the agency's Company token and stores it
// (lib/ghl-oauth.ts), then lists the sub-accounts the install reached so the
// person installing can see at a glance that it worked.
//
// Excluded from middleware: nobody has a dashboard session at this point. The
// code is the proof — it is single-use, short-lived, and only redeemable with
// this app's client secret.
import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeCode,
  forgetLocationTokens,
  listInstalledLocations,
  saveCompanyToken,
  type InstalledLocation,
} from "@/lib/ghl-oauth";

export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 20px;color:#1a1a1a;line-height:1.5}
h1{font-size:1.4rem}ul{padding-left:1.2rem}code{background:#f3f3f3;padding:1px 4px;border-radius:3px}.muted{color:#666}</style>
</head><body><h1>${esc(title)}</h1>${body}</body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return page("Falta el código de autorización", "<p>Esta página solo se abre al instalar la app desde GHL.</p>", 400);
  }

  // Must match the Redirect URL registered in the app byte for byte.
  const redirectUri = `${req.nextUrl.origin}/api/oauth/callback`;

  let companyId: string;
  let futureLocations: boolean | undefined;
  try {
    const token = await exchangeCode(code, redirectUri);
    await saveCompanyToken(token);
    await forgetLocationTokens(token.companyId);
    companyId = token.companyId;
    futureLocations = token.installToFutureLocations;
  } catch (err) {
    console.error("[oauth/callback] install failed", err);
    return page(
      "No se pudo completar la instalación",
      `<p>Intenta instalar de nuevo desde GHL. Si se repite, este es el detalle:</p><p><code>${esc(String(err))}</code></p>`,
      500,
    );
  }

  // The token is already stored: a failure listing locations is cosmetic.
  let locations: InstalledLocation[] | null = null;
  try {
    locations = await listInstalledLocations(companyId);
  } catch (err) {
    console.error("[oauth/callback] could not list installed locations", err);
  }

  const future =
    futureLocations === undefined
      ? ""
      : `<p>Sub-cuentas nuevas: <strong>${futureLocations ? "se instala automáticamente" : "hay que instalarla a mano"}</strong>.</p>`;
  const list =
    locations === null
      ? `<p class="muted">El token quedó guardado, pero no se pudo leer la lista de sub-cuentas.</p>`
      : `<p>Instalada en <strong>${locations.length}</strong> sub-cuenta${locations.length === 1 ? "" : "s"}:</p>
         <ul>${locations
           .map((l) => l.name ?? l._id)
           .sort((a, b) => a.localeCompare(b, "es"))
           .map((n) => `<li>${esc(n)}</li>`)
           .join("")}</ul>`;

  return page("App instalada ✅", `${future}${list}<p class="muted">Agencia <code>${esc(companyId)}</code>. Ya puedes cerrar esta pestaña.</p>`);
}
