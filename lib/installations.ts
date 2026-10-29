// lib/installations.ts
// Which sub-accounts have the Marketplace app installed — and therefore a
// dashboard. The owner's rule (2026-10-28): installing the app IS turning the
// dashboard on; uninstalling it turns it off. No separate allowlist.
//
// GHL's own installed-locations list is the authority. The INSTALL webhook may
// not fire for "future locations" installs (GHL's docs say so), so nothing here
// depends on receiving it: reconcileInstallations() re-reads the list, and it
// runs both from the webhook and from SSO when an unknown sub-account knocks.
//
// One row per location, never deleted: uninstalling stamps uninstalled_at, so a
// reinstall gets its old client id (and its cached payload key) back.
import { getSql } from "./db";
import { listInstalledLocations } from "./ghl-oauth";
import { AGENCY_COMPANY_ID } from "./ghl-sso";

export interface Installation {
  locationId: string;
  clientId: string;
  name: string;
}

// The session token is dot-delimited and embeds the id: same rule as the env
// roster's ID_RE in lib/clients.ts.
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "cliente";
}

// Pure. `taken` holds every id already in use (env roster + table).
export function uniqueClientId(name: string, locationId: string, taken: Set<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  const withLoc = `${base}-${locationId.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  if (!taken.has(withLoc)) return withLoc;
  for (let n = 2; ; n++) if (!taken.has(`${withLoc}-${n}`)) return `${withLoc}-${n}`;
}

export async function listActiveInstallations(): Promise<Installation[]> {
  const rows = await getSql()`
    SELECT location_id, client_id, name FROM dashboard_installation
     WHERE uninstalled_at IS NULL
  `;
  return rows.map((r) => ({ locationId: r.location_id, clientId: r.client_id, name: r.name }));
}

// Re-reads GHL's list and makes the table match it. A location that is already
// an env-roster client keeps that client's id (one identity per sub-account,
// one cache row); every other env id is reserved so an auto-assigned id never
// shadows a configured client.
export async function reconcileInstallations(
  envClients: { id: string; locationId: string }[],
): Promise<{ added: number; removed: number }> {
  const sql = getSql();
  const installed = await listInstalledLocations(AGENCY_COMPANY_ID);
  const known = await sql`SELECT location_id, client_id, uninstalled_at FROM dashboard_installation`;
  const byLoc = new Map(known.map((r) => [r.location_id as string, r]));
  const envIdByLoc = new Map(envClients.map((c) => [c.locationId, c.id]));
  const taken = new Set<string>([...envClients.map((c) => c.id), ...known.map((r) => r.client_id as string)]);

  let added = 0;
  for (const loc of installed) {
    const row = byLoc.get(loc._id);
    if (!row) {
      const clientId = envIdByLoc.get(loc._id) ?? uniqueClientId(loc.name ?? loc._id, loc._id, taken);
      taken.add(clientId);
      await sql`
        INSERT INTO dashboard_installation (location_id, client_id, name, company_id)
        VALUES (${loc._id}, ${clientId}, ${loc.name ?? loc._id}, ${AGENCY_COMPANY_ID})
        ON CONFLICT (location_id) DO NOTHING
      `;
      added++;
    } else if (row.uninstalled_at) {
      await sql`
        UPDATE dashboard_installation
           SET uninstalled_at = NULL, name = ${loc.name ?? loc._id}, updated_at = now()
         WHERE location_id = ${loc._id}
      `;
      added++;
    }
  }

  // An empty list against live rows looks like a GHL hiccup, not a mass
  // uninstall — refusing to act on it costs one stale dashboard at worst.
  let removed = 0;
  const present = new Set(installed.map((l) => l._id));
  const active = known.filter((r) => !r.uninstalled_at);
  if (installed.length > 0) {
    for (const r of active) {
      if (!present.has(r.location_id)) {
        await markUninstalled(r.location_id);
        removed++;
      }
    }
  } else if (active.length > 0) {
    console.warn(`[installations] GHL listed 0 installs against ${active.length} active rows; not removing any`);
  }
  return { added, removed };
}

// Turns the dashboard off and drops what it held: the cached location token and
// the cached payload (personal data with no reason to outlive the install).
export async function markUninstalled(locationId: string): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    UPDATE dashboard_installation SET uninstalled_at = now(), updated_at = now()
     WHERE location_id = ${locationId} AND uninstalled_at IS NULL
    RETURNING client_id
  `;
  await sql`DELETE FROM ghl_location_token WHERE location_id = ${locationId}`;
  if (rows.length > 0) {
    await sql`DELETE FROM project_sync WHERE project_id = ${rows[0].client_id}`;
  }
}

// The app was removed from the whole agency: every dashboard goes, and so does
// the Company token, which GHL has already revoked.
export async function markCompanyUninstalled(companyId: string): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    SELECT location_id FROM dashboard_installation
     WHERE company_id = ${companyId} AND uninstalled_at IS NULL
  `;
  for (const r of rows) await markUninstalled(r.location_id);
  await sql`DELETE FROM ghl_location_token WHERE company_id = ${companyId}`;
  await sql`DELETE FROM ghl_oauth_token WHERE company_id = ${companyId}`;
}
