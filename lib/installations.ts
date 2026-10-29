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
  /** Optional login override; null = the location id is the password. */
  password: string | null;
}

// The session token is dot-delimited and embeds the id, so ids are limited to
// [a-z0-9-] — no dots.
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "cliente";
}

// Pure. `taken` holds every id already in the table.
export function uniqueClientId(name: string, locationId: string, taken: Set<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  const withLoc = `${base}-${locationId.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  if (!taken.has(withLoc)) return withLoc;
  for (let n = 2; ; n++) if (!taken.has(`${withLoc}-${n}`)) return `${withLoc}-${n}`;
}

export async function listActiveInstallations(): Promise<Installation[]> {
  const rows = await getSql()`
    SELECT location_id, client_id, name, password FROM dashboard_installation
     WHERE uninstalled_at IS NULL
  `;
  return rows.map((r) => ({
    locationId: r.location_id,
    clientId: r.client_id,
    name: r.name,
    password: r.password ?? null,
  }));
}

// Re-reads GHL's list and makes the table match it. Ids of locations already in
// the table are never reassigned — they key live sessions and cached payloads.
// (The nine sub-accounts migrated from the old env roster kept their env ids.)
export async function reconcileInstallations(): Promise<{ added: number; removed: number }> {
  const sql = getSql();
  const installed = await listInstalledLocations(AGENCY_COMPANY_ID);
  const known = await sql`SELECT location_id, client_id, uninstalled_at FROM dashboard_installation`;
  const byLoc = new Map(known.map((r) => [r.location_id as string, r]));
  const taken = new Set<string>(known.map((r) => r.client_id as string));

  let added = 0;
  for (const loc of installed) {
    const row = byLoc.get(loc._id);
    if (!row) {
      // GHL delivers INSTALL in bursts (four in one second on 2026-10-28), so
      // reconciles race. No conflict target: a lost race on location_id OR on
      // client_id is skipped, and the next reconcile settles it.
      const clientId = uniqueClientId(loc.name ?? loc._id, loc._id, taken);
      taken.add(clientId);
      await sql`
        INSERT INTO dashboard_installation (location_id, client_id, name, company_id)
        VALUES (${loc._id}, ${clientId}, ${loc.name ?? loc._id}, ${AGENCY_COMPANY_ID})
        ON CONFLICT DO NOTHING
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
