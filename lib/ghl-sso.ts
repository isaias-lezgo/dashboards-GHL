// lib/ghl-sso.ts
// Decrypts the user context GHL hands a Custom Page (the "Dashboard" entry in a
// sub-account's left menu). The page asks its parent frame for
// REQUEST_USER_DATA and receives an opaque string encrypted with the app's
// Shared Secret (GHL_APP_SSO_KEY). That string is the ONLY trustworthy source of
// "which sub-account is this": URL variables like {{location.id}} are editable
// by anyone and must never pick the tenant.
//
// GHL encrypts with CryptoJS.AES.encrypt(json, passphrase), i.e. the OpenSSL
// passphrase format: base64("Salted__" + 8-byte salt + AES-256-CBC ciphertext),
// key and IV derived with EVP_BytesToKey (MD5, one iteration). Reproduced here
// with node:crypto so the app does not pull in crypto-js for one call.
//
// CBC carries no authentication tag, so a wrong key does not always throw — it
// can yield garbage that happens to unpad. The JSON parse and the field checks
// below are what reject it.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// The only agency this deployment serves. Not a secret — it shows up in every
// GHL URL — so a constant, like the rest of the tenancy rules.
export const AGENCY_COMPANY_ID = "LkhcnqrWIwMDHdc6oN5F";

export interface GhlUserContext {
  userId: string;
  companyId: string;
  type: "agency" | "location";
  activeLocation?: string;
  role?: string;
  userName?: string;
  email?: string;
}

function evpBytesToKey(passphrase: Buffer, salt: Buffer): { key: Buffer; iv: Buffer } {
  const out: Buffer[] = [];
  let prev = Buffer.alloc(0);
  let len = 0;
  while (len < 48) {
    prev = createHash("md5").update(Buffer.concat([prev, passphrase, salt])).digest();
    out.push(prev);
    len += prev.length;
  }
  const all = Buffer.concat(out);
  return { key: all.subarray(0, 32), iv: all.subarray(32, 48) };
}

// The inverse of decrypt — exists for scripts/verify-sso.ts, which needs real
// ciphertext in GHL's exact format to test against.
export function encryptLikeCryptoJs(plain: string, passphrase: string): string {
  const salt = randomBytes(8);
  const { key, iv } = evpBytesToKey(Buffer.from(passphrase, "utf8"), salt);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("Salted__"), salt, ct]).toString("base64");
}

export function decryptUserContext(encrypted: string, passphrase: string): GhlUserContext {
  const raw = Buffer.from(encrypted, "base64");
  if (raw.length < 32 || raw.subarray(0, 8).toString("latin1") !== "Salted__") {
    throw new Error("Not a CryptoJS passphrase ciphertext");
  }
  const salt = raw.subarray(8, 16);
  const { key, iv } = evpBytesToKey(Buffer.from(passphrase, "utf8"), salt);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const plain = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString("utf8");

  const data = JSON.parse(plain) as Partial<GhlUserContext>;
  if (typeof data.userId !== "string" || typeof data.companyId !== "string") {
    throw new Error("User context is missing userId/companyId");
  }
  if (data.type !== "agency" && data.type !== "location") {
    throw new Error(`Unexpected user context type: ${String(data.type)}`);
  }
  return data as GhlUserContext;
}

export type SsoDecision =
  | { ok: true; locationId: string }
  | { ok: false; reason: "wrong_agency" | "agency_view" };

// Pure, so the tenancy rule is testable without a request.
export function decideSso(ctx: GhlUserContext): SsoDecision {
  if (ctx.companyId !== AGENCY_COMPANY_ID) return { ok: false, reason: "wrong_agency" };
  // Decided by activeLocation alone, NOT by `type`. `type` describes the USER:
  // an agency admin opening the Dashboard inside a sub-account arrives as
  // type "agency" with that sub-account in activeLocation — gating on
  // type === "location" locked every agency user out (Lezgo Suite, 2026-10-28).
  // Only the agency menu itself sends no activeLocation: no client to show.
  if (!ctx.activeLocation) return { ok: false, reason: "agency_view" };
  return { ok: true, locationId: ctx.activeLocation };
}
