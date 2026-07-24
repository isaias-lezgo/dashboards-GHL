// lib/clients.ts
// The project roster — the seam between "where project config comes from" and
// everything downstream. Nothing outside this file knows the roster is backed by
// an env var, so swapping in a database later touches only this file.
//
// Note: `client` is the internal vocabulary; the UI calls these "proyectos".
// A project id may not contain a dot — it rides inside the dot-delimited
// dash_project cookie (see lib/auth.ts).

export interface ClientConfig {
  id: string;
  name: string;
  locationId: string;
  ghlToken: string;
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
    const client: ClientConfig = {
      id: e.id as string,
      name: e.name as string,
      locationId: e.locationId as string,
      ghlToken: e.ghlToken as string,
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
