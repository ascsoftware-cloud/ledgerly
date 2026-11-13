import { createHash } from "node:crypto";
import { payfastAmountToCents } from "./amounts";

/**
 * PayFast rules, from developers.payfast.co.za (checked 2026-11-12, see docs/plans/phase-3.md).
 * The form signature uses fields in this documented order, never alphabetical.
 */
export const PAYFAST_FIELD_ORDER = [
  "merchant_id",
  "merchant_key",
  "return_url",
  "cancel_url",
  "notify_url",
  "name_first",
  "name_last",
  "email_address",
  "cell_number",
  "m_payment_id",
  "amount",
  "item_name",
  "item_description",
  "custom_int1",
  "custom_int2",
  "custom_int3",
  "custom_int4",
  "custom_int5",
  "custom_str1",
  "custom_str2",
  "custom_str3",
  "custom_str4",
  "custom_str5",
  "email_confirmation",
  "confirmation_address",
  "payment_method",
  // Subscriptions (Ledgerly Pro): these follow payment_method in PayFast's signature order.
  "subscription_type",
  "billing_date",
  "recurring_amount",
  "frequency",
  "cycles",
] as const;

export const PAYFAST_HOSTS = ["www.payfast.co.za", "w1w.payfast.co.za", "w2w.payfast.co.za", "sandbox.payfast.co.za"];

/** PHP urlencode: spaces as "+", upper-case hex, only A–Z a–z 0–9 - _ . left as they are. */
export function phpUrlencode(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/** Signature for the checkout form: non-blank fields, trimmed, encoded, joined in order, plus passphrase. */
export function payfastSignature(fields: [string, string][], passphrase?: string | null): string {
  const parts = fields.filter(([, v]) => v.trim() !== "").map(([k, v]) => `${k}=${phpUrlencode(v.trim())}`);
  if (passphrase) parts.push(`passphrase=${phpUrlencode(passphrase.trim())}`);
  return createHash("md5").update(parts.join("&")).digest("hex");
}

/** The ITN's own fields, in the order received, up to (not including) "signature". */
export function payfastItnParamString(body: URLSearchParams): string {
  const parts: string[] = [];
  for (const [k, v] of body) {
    if (k === "signature") break;
    parts.push(`${k}=${phpUrlencode(v)}`);
  }
  return parts.join("&");
}

export type ItnCheck = { ok: true } | { ok: false; reason: "signature" | "source" | "amount" | "merchant" | "validate" };

/**
 * PayFast's four required checks, plus one of ours (the notification is for this merchant).
 * Any failure means: do not mark anything paid.
 */
export async function verifyPayfastItn(input: {
  body: URLSearchParams;
  passphrase: string | null;
  /** null skips the amount check (a cancellation notice carries no payment). */
  expectedCents: number | null;
  merchantId: string;
  sourceIp: string;
  validIps: string[];
  validateWithPayfast: (paramString: string) => Promise<boolean>;
}): Promise<ItnCheck> {
  const paramString = payfastItnParamString(input.body);
  const withPass = input.passphrase ? `${paramString}&passphrase=${phpUrlencode(input.passphrase)}` : paramString;
  const expected = createHash("md5").update(withPass).digest("hex");
  if (input.body.get("signature") !== expected) return { ok: false, reason: "signature" };
  if (!input.validIps.includes(input.sourceIp)) return { ok: false, reason: "source" };
  if (input.body.get("merchant_id") !== input.merchantId) return { ok: false, reason: "merchant" };
  if (input.expectedCents !== null) {
    const gross = payfastAmountToCents(input.body.get("amount_gross"));
    // Exact to the cent. PayFast's PHP sample allows R0.01 only because PHP uses floats.
    if (gross === null || gross !== input.expectedCents) return { ok: false, reason: "amount" };
  }
  if (!(await input.validateWithPayfast(paramString))) return { ok: false, reason: "validate" };
  return { ok: true };
}
