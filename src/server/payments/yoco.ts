import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 180; // Yoco recommends 3 minutes.

export type WebhookCheck = { ok: true } | { ok: false; reason: "headers" | "timestamp" | "signature" };

/**
 * Yoco webhooks follow Standard Webhooks: HMAC-SHA256 over "id.timestamp.rawBody" with the
 * base64-decoded secret (after "whsec_"), compared in constant time against every
 * "v1,<sig>" entry in the header.
 */
export function verifyYocoWebhook(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: Date;
}): WebhookCheck {
  if (!input.id || !input.timestamp || !input.signature) return { ok: false, reason: "headers" };
  const ts = Number(input.timestamp);
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isInteger(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp" };

  const key = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${input.id}.${input.timestamp}.${input.body}`).digest();

  for (const entry of input.signature.split(" ")) {
    const [version, sig] = entry.split(",", 2);
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "signature" };
}
