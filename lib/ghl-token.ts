// lib/ghl-token.ts
// Which bearer token ghlFetch sends for a client: the Marketplace app's OAuth
// location token when the app is installed on that sub-account, otherwise the
// client's PIT from the roster. Both coexist while clients migrate; a client
// without a PIT is OAuth-only and fails loudly when no token can be had.
//
// ghlFetch runs hundreds of times per sync, many concurrently, so this must not
// touch Neon (let alone GHL) per call:
//   - an in-memory cache per instance, keyed by location id;
//   - in-flight dedupe, so 40 concurrent first calls produce ONE mint;
//   - a negative cache, so a sub-account without the app does not retry a
//     failing mint on every request — it rides its PIT for a few minutes.
//
// Never keyed by anything but the location id, and never a module-level
// "current token": the same rule as lib/ghl-context.ts.
import type { ClientConfig } from "./clients";
import { getLocationAccessToken, needsRefresh } from "./ghl-oauth";
import { AGENCY_COMPANY_ID } from "./ghl-sso";
import { isDbConfigured } from "./db";

export type TokenSource = "oauth" | "pit";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

// How long a failed OAuth lookup sends a location to its PIT before retrying.
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
// In-memory copies are trusted for at most this long, independent of expiry,
// so a token revoked by an uninstall does not linger in a warm instance.
const MEMORY_TTL_MS = 10 * 60 * 1000;

const memory = new Map<string, { token: string; expiresAt: Date; cachedAt: number }>();
const inFlight = new Map<string, Promise<{ token: string; expiresAt: Date }>>();
const negative = new Map<string, number>();

function oauthEnabled(): boolean {
  // Kill switch: GHL_OAUTH_DISABLED=1 sends every client back to its PIT.
  return (
    process.env.GHL_OAUTH_DISABLED !== "1" &&
    isDbConfigured() &&
    Boolean(process.env.GHL_APP_CLIENT_ID && process.env.GHL_TOKEN_ENC_KEY)
  );
}

function pitOrThrow(client: ClientConfig, why: string): ResolvedToken {
  if (client.ghlToken) return { token: client.ghlToken, source: "pit" };
  throw new Error(`No GHL token for ${client.id}: ${why}`);
}

export async function resolveGhlToken(
  client: ClientConfig,
  opts: { forceRefresh?: boolean } = {},
): Promise<ResolvedToken> {
  if (!oauthEnabled()) return pitOrThrow(client, "OAuth is not configured");
  const loc = client.locationId;

  if (opts.forceRefresh) {
    memory.delete(loc);
    negative.delete(loc);
  } else {
    const hit = memory.get(loc);
    if (hit && !needsRefresh(hit.expiresAt) && Date.now() - hit.cachedAt < MEMORY_TTL_MS) {
      return { token: hit.token, source: "oauth" };
    }
    const until = negative.get(loc);
    if (until && until > Date.now()) return pitOrThrow(client, "the app is not installed on this sub-account");
  }

  let pending = inFlight.get(loc);
  if (!pending) {
    // Cache bookkeeping and logging happen once, here, not once per waiter.
    pending = getLocationAccessToken(AGENCY_COMPANY_ID, loc, { force: opts.forceRefresh })
      .then((t) => {
        memory.set(loc, { ...t, cachedAt: Date.now() });
        negative.delete(loc);
        return t;
      })
      .catch((err) => {
        negative.set(loc, Date.now() + NEGATIVE_TTL_MS);
        console.warn(`[ghl-token] OAuth unavailable for ${client.id}, using PIT if any:`, String(err).slice(0, 200));
        throw err;
      })
      .finally(() => inFlight.delete(loc));
    inFlight.set(loc, pending);
  }

  try {
    return { token: (await pending).token, source: "oauth" };
  } catch (err) {
    return pitOrThrow(client, String(err));
  }
}

// For scripts/check-oauth-sync.ts only.
export function __resetTokenCache(): void {
  memory.clear();
  inFlight.clear();
  negative.clear();
}
