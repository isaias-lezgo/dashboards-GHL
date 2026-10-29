// lib/ghl-token.ts
// The bearer token ghlFetch sends for a client: the Marketplace app's OAuth
// location token. The per-client PITs are gone (2026-10-28), so there is no
// fallback — a sub-account the app cannot mint a token for fails loudly.
//
// ghlFetch runs hundreds of times per sync, many concurrently, so this must not
// touch Neon (let alone GHL) per call:
//   - an in-memory cache per instance, keyed by location id;
//   - in-flight dedupe, so 40 concurrent first calls produce ONE mint.
//
// Never keyed by anything but the location id, and never a module-level
// "current token": the same rule as lib/ghl-context.ts.
import type { ClientConfig } from "./clients";
import { getLocationAccessToken, needsRefresh } from "./ghl-oauth";
import { AGENCY_COMPANY_ID } from "./ghl-sso";

// In-memory copies are trusted for at most this long, independent of expiry,
// so a token revoked by an uninstall does not linger in a warm instance.
const MEMORY_TTL_MS = 10 * 60 * 1000;

const memory = new Map<string, { token: string; expiresAt: Date; cachedAt: number }>();
const inFlight = new Map<string, Promise<{ token: string; expiresAt: Date }>>();

export async function resolveGhlToken(
  client: ClientConfig,
  opts: { forceRefresh?: boolean } = {},
): Promise<string> {
  const loc = client.locationId;

  if (opts.forceRefresh) {
    memory.delete(loc);
  } else {
    const hit = memory.get(loc);
    if (hit && !needsRefresh(hit.expiresAt) && Date.now() - hit.cachedAt < MEMORY_TTL_MS) return hit.token;
  }

  let pending = inFlight.get(loc);
  if (!pending) {
    pending = getLocationAccessToken(AGENCY_COMPANY_ID, loc, { force: opts.forceRefresh })
      .then((t) => {
        memory.set(loc, { ...t, cachedAt: Date.now() });
        return t;
      })
      .catch((err) => {
        throw new Error(`No GHL token for ${client.id} — is the app installed on this sub-account? ${String(err)}`);
      })
      .finally(() => inFlight.delete(loc));
    inFlight.set(loc, pending);
  }
  return (await pending).token;
}
