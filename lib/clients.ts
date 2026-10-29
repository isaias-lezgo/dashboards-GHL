// lib/clients.ts
// The client roster — the seam between "where client config comes from" and
// everything downstream. Two sources, merged here and nowhere else:
//   - DASHBOARD_CLIENTS (env): the original roster, each client with a PIT;
//   - dashboard_installation (Neon): every sub-account with the Marketplace app
//     installed (lib/installations.ts). These carry no PIT — OAuth only.
// The env wins on a shared location id. The database is optional: without it,
// or when it fails, the roster is the env alone, exactly as before.
import { safeEqual } from "./auth";
import { isDbConfigured } from "./db";
import { listActiveInstallations, reconcileInstallations } from "./installations";

export interface ClientConfig {
  id: string;
  name: string;
  locationId: string;
  // The client's Private Integration Token. Absent for clients that exist only
  // through the Marketplace app install; lib/ghl-token.ts then requires OAuth.
  ghlToken?: string;
  // Optional override. Absent = the GHL location id doubles as the password.
  // See the design doc's "Password model" for the accepted risk; this field is
  // the escape hatch that makes a single client's password rotatable.
  password?: string;
}

export function effectivePassword(c: ClientConfig): string {
  return c.password ?? c.locationId;
}

// The session token is dot-delimited and embeds the id, so ids may not contain dots.
const ID_RE = /^[a-z0-9-]+$/;
const REQUIRED = ["id", "name", "locationId", "ghlToken"] as const;

// Pure. Throws with an actionable message on any invalid roster — a half-valid
// roster in production is far worse than a loud failure at startup.
export function parseClients(raw: string): ClientConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DASHBOARD_CLIENTS is not valid JSON: ${msg}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("DASHBOARD_CLIENTS must be a JSON array");
  }
  if (parsed.length === 0) {
    throw new Error("DASHBOARD_CLIENTS is empty — no clients configured");
  }

  const clients: ClientConfig[] = [];
  const seenIds = new Set<string>();
  const seenPasswords = new Set<string>();

  parsed.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`DASHBOARD_CLIENTS[${i}] is not an object`);
    }
    const e = entry as Record<string, unknown>;

    for (const field of REQUIRED) {
      const v = e[field];
      if (typeof v !== "string" || v.trim() === "") {
        throw new Error(`DASHBOARD_CLIENTS[${i}] is missing required field "${field}"`);
      }
    }
    if (e.password !== undefined && (typeof e.password !== "string" || e.password.trim() === "")) {
      throw new Error(
        `DASHBOARD_CLIENTS[${i}] has an empty "password" — omit the field entirely to default to locationId`,
      );
    }

    const client: ClientConfig = {
      id: e.id as string,
      name: e.name as string,
      locationId: e.locationId as string,
      ghlToken: e.ghlToken as string,
      ...(e.password !== undefined ? { password: e.password as string } : {}),
    };

    if (!ID_RE.test(client.id)) {
      throw new Error(
        `DASHBOARD_CLIENTS[${i}] has an invalid id "${client.id}" — use lowercase letters, digits and hyphens only`,
      );
    }
    if (seenIds.has(client.id)) {
      throw new Error(`DASHBOARD_CLIENTS has a duplicate id "${client.id}"`);
    }
    seenIds.add(client.id);

    // Two clients with the same effective password would make the login lookup
    // ambiguous — one would silently shadow the other.
    const pw = effectivePassword(client);
    if (seenPasswords.has(pw)) {
      throw new Error(`DASHBOARD_CLIENTS: client "${client.id}" shares a password with another client`);
    }
    seenPasswords.add(pw);

    clients.push(client);
  });

  return clients;
}

// Lazy + cached. Lazy (rather than parsing at module load) so that importing this
// module in an environment without the env var doesn't throw at import time.
let cache: ClientConfig[] | null = null;

export function getClients(): ClientConfig[] {
  if (cache) return cache;
  const raw = process.env.DASHBOARD_CLIENTS;
  if (!raw) throw new Error("DASHBOARD_CLIENTS is not set");
  cache = parseClients(raw);
  return cache;
}

export function getClientById(id: string): ClientConfig | null {
  return getClients().find((c) => c.id === id) ?? null;
}

// Compares against EVERY client with no early return, so response timing doesn't
// reveal which client a wrong password nearly matched.
export function findClientByPassword(password: string): ClientConfig | null {
  if (password === "") return null;
  let match: ClientConfig | null = null;
  for (const c of getClients()) {
    if (safeEqual(password, effectivePassword(c))) match = c;
  }
  return match;
}

// ── Merged roster (env + app installs) ───────────────────────────────────────
// Async because the installs live in Neon. Session checks run on every API
// request, so the installs are cached per instance briefly; an uninstall
// therefore revokes live sessions within INSTALLS_CACHE_MS.

const INSTALLS_CACHE_MS = 60_000;
// SSO from an unknown sub-account triggers a reconcile with GHL; at most this often.
const RECONCILE_MIN_INTERVAL_MS = 30_000;

let installsCache: { at: number; clients: ClientConfig[] } | null = null;
let lastReconcileAt = 0;

function envClients(): ClientConfig[] {
  // An unset env is a valid state once every client is an app install. A SET but
  // invalid env still throws — loud beats half a roster.
  return process.env.DASHBOARD_CLIENTS ? getClients() : [];
}

async function installedClients(): Promise<ClientConfig[]> {
  if (!isDbConfigured()) return [];
  if (installsCache && Date.now() - installsCache.at < INSTALLS_CACHE_MS) return installsCache.clients;
  try {
    const rows = await listActiveInstallations();
    const clients = rows.map((r) => ({ id: r.clientId, name: r.name, locationId: r.locationId }));
    installsCache = { at: Date.now(), clients };
    return clients;
  } catch (err) {
    console.error("[clients] could not read app installs; serving the env roster only:", err);
    return installsCache?.clients ?? [];
  }
}

export async function getRoster(): Promise<ClientConfig[]> {
  const env = envClients();
  const envLocs = new Set(env.map((c) => c.locationId));
  const envIds = new Set(env.map((c) => c.id));
  const extra = (await installedClients()).filter((c) => !envLocs.has(c.locationId) && !envIds.has(c.id));
  return [...env, ...extra];
}

export async function resolveClientById(id: string): Promise<ClientConfig | null> {
  return (await getRoster()).find((c) => c.id === id) ?? null;
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
  if (hit || !isDbConfigured() || Date.now() - lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) return hit;
  lastReconcileAt = Date.now();
  try {
    await reconcileInstallations(envClients());
  } catch (err) {
    console.error("[clients] reconcile on SSO miss failed:", err);
    return null;
  }
  invalidateRosterCache();
  return find();
}

export function invalidateRosterCache(): void {
  installsCache = null;
}
