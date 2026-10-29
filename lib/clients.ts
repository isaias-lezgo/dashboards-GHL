// lib/clients.ts
// The client roster — the seam between "where client config comes from" and
// everything downstream. Since 2026-10-28 the roster IS the set of sub-accounts
// with the Marketplace app installed (dashboard_installation in Neon, kept in
// step with GHL by lib/installations.ts). The old DASHBOARD_CLIENTS env roster
// and its per-client PITs are gone: every GHL call goes through OAuth.
//
// That makes the database a hard dependency for WHO a client is. When it fails,
// the last roster this instance read keeps serving (for a bounded time); with no
// such copy, lookups fail closed — nobody is let in rather than the wrong client.
import { safeEqual } from "./auth";
import { isDbConfigured } from "./db";
import { listActiveInstallations, reconcileInstallations } from "./installations";

export interface ClientConfig {
  id: string;
  name: string;
  locationId: string;
  // Optional override. Absent = the GHL location id doubles as the password.
  // See "Password model" in CLAUDE.md for the accepted risk; this field is the
  // escape hatch that makes a single client's password rotatable — set it in
  // dashboard_installation.password.
  password?: string;
}

export function effectivePassword(c: ClientConfig): string {
  return c.password ?? c.locationId;
}

// Pure. Compares against EVERY client with no early return, so response timing
// doesn't reveal which client a wrong password nearly matched. Two clients with
// the same effective password match nobody: an ambiguous login must not pick one.
export function pickByPassword(clients: ClientConfig[], password: string): ClientConfig | null {
  if (password === "") return null;
  let match: ClientConfig | null = null;
  let count = 0;
  for (const c of clients) {
    if (safeEqual(password, effectivePassword(c))) {
      match = c;
      count++;
    }
  }
  return count === 1 ? match : null;
}

// ── Roster (app installs) ────────────────────────────────────────────────────
// Session checks run on every API request, so the roster is cached per instance
// briefly; an uninstall therefore revokes live sessions within ROSTER_CACHE_MS.

const ROSTER_CACHE_MS = 60_000;
// How long a stale copy may stand in while Neon is failing.
const ROSTER_STALE_MAX_MS = 30 * 60_000;
// SSO from an unknown sub-account triggers a reconcile with GHL; at most this often.
const RECONCILE_MIN_INTERVAL_MS = 30_000;

let rosterCache: { at: number; clients: ClientConfig[] } | null = null;
let lastReconcileAt = 0;

export async function getRoster(): Promise<ClientConfig[]> {
  if (!isDbConfigured()) throw new Error("DATABASE_URL is not set — the client roster lives in Neon");
  if (rosterCache && Date.now() - rosterCache.at < ROSTER_CACHE_MS) return rosterCache.clients;
  try {
    const rows = await listActiveInstallations();
    const clients = rows.map((r) => ({
      id: r.clientId,
      name: r.name,
      locationId: r.locationId,
      ...(r.password ? { password: r.password } : {}),
    }));
    rosterCache = { at: Date.now(), clients };
    return clients;
  } catch (err) {
    if (rosterCache && Date.now() - rosterCache.at < ROSTER_STALE_MAX_MS) {
      console.error("[clients] could not read the roster; serving this instance's last copy:", err);
      return rosterCache.clients;
    }
    throw err;
  }
}

export async function resolveClientById(id: string): Promise<ClientConfig | null> {
  return (await getRoster()).find((c) => c.id === id) ?? null;
}

export async function findClientByPassword(password: string): Promise<ClientConfig | null> {
  return pickByPassword(await getRoster(), password);
}

// For SSO. A sub-account GHL vouches for but we do not know yet is most likely
// a fresh install whose webhook never arrived — re-read GHL's list once and retry.
export async function resolveClientByLocationId(locationId: string): Promise<ClientConfig | null> {
  if (!locationId) return null;
  const find = async () => {
    const matches = (await getRoster()).filter((c) => c.locationId === locationId);
    return matches.length === 1 ? matches[0] : null;
  };
  const hit = await find();
  if (hit || Date.now() - lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) return hit;
  lastReconcileAt = Date.now();
  try {
    await reconcileInstallations();
  } catch (err) {
    console.error("[clients] reconcile on SSO miss failed:", err);
    return null;
  }
  invalidateRosterCache();
  return find();
}

export function invalidateRosterCache(): void {
  rosterCache = null;
}
