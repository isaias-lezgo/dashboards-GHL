// lib/ghl-webhook.ts
// Verifies GHL webhook signatures: Ed25519 over the request body, base64 in the
// X-GHL-Signature header, against GHL's published public key.
//
// GHL's docs sign `JSON.stringify(req.body)` in their examples and never say
// "raw body", so the raw bytes are tried first and the re-serialized JSON second.
// Both are GHL's own bytes; neither lets an unsigned body through.
import { createPublicKey, verify, type KeyObject } from "node:crypto";

// From https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide
const GHL_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

let ghlKey: KeyObject | null = null;

export function verifyGhlWebhook(rawBody: string, signature: string | null, key?: KeyObject): boolean {
  if (!signature) return false;
  const k = key ?? (ghlKey ??= createPublicKey(GHL_WEBHOOK_PUBLIC_KEY));
  let sig: Buffer;
  try {
    sig = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;

  const candidates = [rawBody];
  try {
    const reserialized = JSON.stringify(JSON.parse(rawBody));
    if (reserialized !== rawBody) candidates.push(reserialized);
  } catch {
    // Not JSON: only the raw bytes can match.
  }
  return candidates.some((body) => {
    try {
      return verify(null, Buffer.from(body, "utf8"), k, sig);
    } catch {
      return false;
    }
  });
}
