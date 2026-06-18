// lib/auth.ts
// Edge-safe auth helpers. Uses Web Crypto (crypto.subtle) so this module can be
// imported from middleware (Edge runtime) as well as Node route handlers.
// No Next.js imports here — keep it pure and runtime-agnostic.

export const SESSION_COOKIE = "dash_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getSecret(): string {
  const secret = process.env.DASHBOARD_AUTH_SECRET;
  if (!secret) {
    throw new Error("DASHBOARD_AUTH_SECRET is not set");
  }
  return secret;
}

// Constant-time string comparison to avoid leaking length/character timing.
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare against a fixed-length XOR accumulator. Differing lengths still
  // run the loop to the max length and fail.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  // hex-encode
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Token format: "<expiryMs>.<hmac(expiryMs)>". Contains no password or PII.
export async function signToken(expiryMs: number): Promise<string> {
  const payload = String(expiryMs);
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function verifyToken(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 0) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expiryMs = Number(payload);
  if (!Number.isFinite(expiryMs)) return false;
  if (Date.now() > expiryMs) return false; // expired
  const expected = await hmac(payload);
  return safeEqual(sig, expected);
}
