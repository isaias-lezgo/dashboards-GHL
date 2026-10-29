// lib/ghl-oauth.ts
// OAuth tokens for the GHL Marketplace app — the replacement for the per-client
// PITs pasted into DASHBOARD_CLIENTS.
//
// The app is distributed at AGENCY level ("who can install: agency only"), so an
// install yields ONE Company token for the whole agency, and every sub-account
// token is minted from it on demand (/oauth/locationToken). That makes the
// Company refresh token the single most valuable secret this app holds:
//
//   - A refresh token is SINGLE-USE. Redeeming it invalidates it and returns a
//     new one. Two serverless instances refreshing at once means the second one
//     redeems an already-dead token, and if the first one's write is lost too,
//     the agency must reinstall the app. Hence claimRefresh(): the decision lives
//     inside the UPDATE's WHERE, same pattern as claimSync in lib/sync-store.ts.
//   - Tokens are encrypted at rest (AES-256-GCM, GHL_TOKEN_ENC_KEY). The Company
//     token reads every sub-account; a leaked database dump must not hand it over.
//
// Location tokens are a CACHE, not state: losing one costs one mint. They are
// stored so a sync does not mint a fresh token on every request.
//
// Server-only. Nothing here may be imported from a client component.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSql } from "./db";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
// The OAuth helper endpoints still answer on the classic version header.
const OAUTH_API_VERSION = "2021-07-28";

// Refresh this long before expiry, so a token never dies mid-sync. A full sync
// runs up to maxDuration (300 s); 10 minutes covers it with room to spare.
export const REFRESH_MARGIN_MS = 10 * 60 * 1000;
// A refresh holding the lock longer than this is presumed dead and may be taken
// over. GHL answers /oauth/token in well under a second.
const REFRESH_LOCK_SECONDS = 60;
// How long a caller that lost the lock waits for the winner's new token.
const REFRESH_WAIT_MS = 15_000;

// ── Config ───────────────────────────────────────────────────────────────────

export interface OAuthAppConfig {
  clientId: string;
  clientSecret: string;
  /** The app's Mongo id — the client id's prefix before the dash. */
  appId: string;
}

export function getAppConfig(): OAuthAppConfig {
  const clientId = process.env.GHL_APP_CLIENT_ID;
  const clientSecret = process.env.GHL_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GHL_APP_CLIENT_ID / GHL_APP_CLIENT_SECRET are not set");
  }
  return { clientId, clientSecret, appId: clientId.split("-")[0] };
}

// ── Encryption at rest ───────────────────────────────────────────────────────
// Format: v1.<iv>.<tag>.<ciphertext>, each base64url. GCM authenticates, so a
// tampered or wrong-key value throws instead of decrypting to garbage.

function encKey(): Buffer {
  const hex = process.env.GHL_TOKEN_ENC_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("GHL_TOKEN_ENC_KEY must be 64 hex chars (openssl rand -hex 32)");
  }
  return Buffer.from(hex, "hex");
}

export function encryptToken(plain: string, key: Buffer = encKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptToken(sealed: string, key: Buffer = encKey()): string {
  const [version, iv, tag, ct] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Malformed sealed token");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function expiresAtFrom(expiresInSeconds: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + expiresInSeconds * 1000);
}

export function needsRefresh(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() <= REFRESH_MARGIN_MS;
}

// ── GHL OAuth endpoints ──────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  userType: "Company" | "Location";
  companyId: string;
  locationId?: string;
  userId?: string;
  isBulkInstallation?: boolean;
  approveAllLocations?: boolean;
  installToFutureLocations?: boolean;
  approvedLocations?: string[];
}

async function postForm<T>(path: string, form: Record<string, string>, bearer?: string): Promise<T> {
  const res = await fetch(`${GHL_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Version: OAUTH_API_VERSION,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // GHL's error bodies never echo the secret back, so they are safe to surface.
    throw new Error(`GHL ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getAppConfig();
  return postForm<TokenResponse>("/oauth/token", {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    user_type: "Company",
    redirect_uri: redirectUri,
  });
}

async function redeemRefreshToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getAppConfig();
  return postForm<TokenResponse>("/oauth/token", {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    user_type: "Company",
  });
}

// ── Company token store ──────────────────────────────────────────────────────

export async function saveCompanyToken(t: TokenResponse): Promise<void> {
  if (t.userType !== "Company") {
    throw new Error(`Expected a Company token, got userType=${t.userType}`);
  }
  await getSql()`
    INSERT INTO ghl_oauth_token (
      company_id, access_token_enc, refresh_token_enc, expires_at, scope,
      install_to_future_locations, approve_all_locations,
      refresh_started_at, last_error, installed_at, updated_at
    ) VALUES (
      ${t.companyId}, ${encryptToken(t.access_token)}, ${encryptToken(t.refresh_token)},
      ${expiresAtFrom(t.expires_in)}, ${t.scope ?? null},
      ${t.installToFutureLocations ?? null}, ${t.approveAllLocations ?? null},
      NULL, NULL, now(), now()
    )
    ON CONFLICT (company_id) DO UPDATE SET
      access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      expires_at = EXCLUDED.expires_at,
      scope = COALESCE(EXCLUDED.scope, ghl_oauth_token.scope),
      install_to_future_locations = COALESCE(EXCLUDED.install_to_future_locations, ghl_oauth_token.install_to_future_locations),
      approve_all_locations = COALESCE(EXCLUDED.approve_all_locations, ghl_oauth_token.approve_all_locations),
      refresh_started_at = NULL,
      last_error = NULL,
      updated_at = now()
  `;
}

// Called on (re)install only, not on refresh: a reinstall can change scopes, and
// location tokens minted from the old Company token would keep the old scope
// until they expired.
export async function forgetLocationTokens(companyId: string): Promise<void> {
  await getSql()`DELETE FROM ghl_location_token WHERE company_id = ${companyId}`;
}

interface CompanyRow {
  access_token_enc: string;
  expires_at: Date;
}

async function readCompanyRow(companyId: string): Promise<CompanyRow | null> {
  const rows = await getSql()`
    SELECT access_token_enc, expires_at FROM ghl_oauth_token WHERE company_id = ${companyId}
  `;
  if (rows.length === 0) return null;
  return { access_token_enc: rows[0].access_token_enc, expires_at: new Date(rows[0].expires_at) };
}

// Atomically takes the refresh lock, and only if a refresh is still needed —
// the expiry check sits in the same WHERE, so a caller arriving just after
// another instance finished refreshing does not redeem the token a second time.
// Returns the sealed refresh token to redeem, or null if someone else holds it.
export async function claimRefresh(companyId: string): Promise<string | null> {
  const marginSeconds = REFRESH_MARGIN_MS / 1000;
  const rows = await getSql()`
    UPDATE ghl_oauth_token
       SET refresh_started_at = now()
     WHERE company_id = ${companyId}
       AND expires_at <= now() + make_interval(secs => ${marginSeconds})
       AND (refresh_started_at IS NULL
            OR refresh_started_at < now() - make_interval(secs => ${REFRESH_LOCK_SECONDS}))
    RETURNING refresh_token_enc
  `;
  return rows.length > 0 ? (rows[0].refresh_token_enc as string) : null;
}

async function releaseRefresh(companyId: string, error: string): Promise<void> {
  await getSql()`
    UPDATE ghl_oauth_token SET refresh_started_at = NULL, last_error = ${error}
     WHERE company_id = ${companyId}
  `;
}

async function refreshCompanyToken(companyId: string, sealedRefresh: string): Promise<string> {
  let fresh: TokenResponse;
  try {
    fresh = await redeemRefreshToken(decryptToken(sealedRefresh));
  } catch (err) {
    await releaseRefresh(companyId, String(err)).catch(() => {});
    throw err;
  }
  // The old refresh token is dead from here on. Losing this write means losing
  // the install, so retry it before giving up.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await saveCompanyToken(fresh);
      return fresh.access_token;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  console.error(`[oauth] refreshed company ${companyId} but could not persist the new token`, lastErr);
  // The access token in hand is still valid for this request.
  return fresh.access_token;
}

export async function getCompanyAccessToken(companyId: string): Promise<string> {
  const row = await readCompanyRow(companyId);
  if (!row) throw new Error(`The GHL app is not installed for company ${companyId}`);
  if (!needsRefresh(row.expires_at)) return decryptToken(row.access_token_enc);

  const sealedRefresh = await claimRefresh(companyId);
  if (sealedRefresh) return refreshCompanyToken(companyId, sealedRefresh);

  // Someone else is refreshing. Wait for their write rather than racing them.
  const deadline = Date.now() + REFRESH_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const again = await readCompanyRow(companyId);
    if (again && !needsRefresh(again.expires_at)) return decryptToken(again.access_token_enc);
  }
  // The winner never finished. The old token may still have minutes left.
  if (row.expires_at.getTime() > Date.now()) return decryptToken(row.access_token_enc);
  throw new Error(`Timed out waiting for the GHL token refresh of company ${companyId}`);
}

// ── Location tokens (cache) ──────────────────────────────────────────────────

export async function getLocationAccessToken(
  companyId: string,
  locationId: string,
  opts: { force?: boolean } = {},
): Promise<{ token: string; expiresAt: Date }> {
  if (!opts.force) {
    const rows = await getSql()`
      SELECT access_token_enc, expires_at FROM ghl_location_token
       WHERE location_id = ${locationId} AND company_id = ${companyId}
    `;
    if (rows.length > 0) {
      const expiresAt = new Date(rows[0].expires_at);
      if (!needsRefresh(expiresAt)) return { token: decryptToken(rows[0].access_token_enc), expiresAt };
    }
  }

  const companyToken = await getCompanyAccessToken(companyId);
  const minted = await postForm<{ access_token: string; expires_in: number; locationId?: string }>(
    "/oauth/locationToken",
    { companyId, locationId },
    companyToken,
  );
  const expiresAt = expiresAtFrom(minted.expires_in);
  await getSql()`
    INSERT INTO ghl_location_token (location_id, company_id, access_token_enc, expires_at, updated_at)
    VALUES (${locationId}, ${companyId}, ${encryptToken(minted.access_token)}, ${expiresAt}, now())
    ON CONFLICT (location_id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      access_token_enc = EXCLUDED.access_token_enc,
      expires_at = EXCLUDED.expires_at,
      updated_at = now()
  `;
  return { token: minted.access_token, expiresAt };
}

// ── Installed locations ──────────────────────────────────────────────────────

export interface InstalledLocation {
  _id: string;
  name: string;
  isInstalled?: boolean;
}

export async function listInstalledLocations(companyId: string): Promise<InstalledLocation[]> {
  const { appId } = getAppConfig();
  const token = await getCompanyAccessToken(companyId);
  const out: InstalledLocation[] = [];
  // Paged with skip/limit; the cursor variant is newer and not needed at this size.
  for (let skip = 0; skip < 5000; skip += 100) {
    const url = new URL(`${GHL_BASE_URL}/oauth/installedLocations`);
    url.searchParams.set("companyId", companyId);
    url.searchParams.set("appId", appId);
    url.searchParams.set("isInstalled", "true");
    url.searchParams.set("limit", "100");
    url.searchParams.set("skip", String(skip));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Version: OAUTH_API_VERSION, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GHL /oauth/installedLocations ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { locations?: InstalledLocation[]; items?: InstalledLocation[] };
    const page = body.locations ?? body.items ?? [];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}
