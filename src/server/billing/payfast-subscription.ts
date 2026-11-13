import { createHash } from "node:crypto";
import { centsToPayfastAmount } from "@/server/payments/amounts";
import { PAYFAST_FIELD_ORDER, payfastSignature, phpUrlencode } from "@/server/payments/payfast";

/**
 * Ledgerly's own PayFast merchant account, used only to charge workspaces for Pro. Per-business PayFast keys
 * (for invoices) are different and live in Vault. Returns null until every value is set.
 * Field names and the cancel API are from PayFast's reference (see docs/plans/phase-7.md): unverified against a
 * live sandbox until the owner's merchant account exists.
 */
export type BillingEnv = { merchantId: string; merchantKey: string; passphrase: string; mode: "sandbox" | "live" };

export function readBillingEnv(env: Record<string, string | undefined> = process.env): BillingEnv | null {
  const merchantId = env.PAYFAST_MERCHANT_ID?.trim();
  const merchantKey = env.PAYFAST_MERCHANT_KEY?.trim();
  const passphrase = env.PAYFAST_PASSPHRASE?.trim();
  if (!merchantId || !merchantKey || !passphrase) return null;
  return { merchantId, merchantKey, passphrase, mode: env.PAYFAST_MODE?.trim().toLowerCase() === "live" ? "live" : "sandbox" };
}

export type SubscriptionForm = { action: string; fields: [string, string][] };

/** A signed monthly subscription (subscription_type 1, frequency 3, cycles 0 = until cancelled). */
export function buildSubscriptionForm(i: {
  env: BillingEnv;
  checkoutId: string;
  amountCents: number;
  email: string;
  nameFirst: string;
  itemName: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  /** First charge date, YYYY-MM-DD. */
  billingDate: string;
}): SubscriptionForm {
  const amount = centsToPayfastAmount(i.amountCents);
  const values: Record<string, string> = {
    merchant_id: i.env.merchantId,
    merchant_key: i.env.merchantKey,
    return_url: i.returnUrl,
    cancel_url: i.cancelUrl,
    notify_url: i.notifyUrl,
    name_first: i.nameFirst,
    email_address: i.email,
    m_payment_id: i.checkoutId,
    amount,
    item_name: i.itemName,
    subscription_type: "1",
    billing_date: i.billingDate,
    recurring_amount: amount,
    frequency: "3",
    cycles: "0",
  };
  const fields = PAYFAST_FIELD_ORDER.filter((k) => values[k]).map((k) => [k, values[k]!] as [string, string]);
  fields.push(["signature", payfastSignature(fields, i.env.passphrase)]);
  const host = i.env.mode === "live" ? "www.payfast.co.za" : "sandbox.payfast.co.za";
  return { action: `https://${host}/eng/process`, fields };
}

/** PayFast API signature: header values plus the passphrase, sorted by name, encoded, MD5. */
export function payfastApiSignature(params: Record<string, string>, passphrase: string): string {
  const all: Record<string, string> = { ...params, passphrase };
  const query = Object.keys(all)
    .sort()
    .map((k) => `${k}=${phpUrlencode(all[k]!)}`)
    .join("&");
  return createHash("md5").update(query).digest("hex");
}

/** Stops PayFast charging this subscription. Failures are plain: nothing secret is ever in the result. */
export async function cancelPayfastSubscription(
  token: string,
  env: BillingEnv,
  opts: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<{ ok: true } | { ok: false }> {
  if (!/^[A-Za-z0-9-]{1,100}$/.test(token)) return { ok: false };
  const doFetch = opts.fetch ?? fetch;
  const timestamp = (opts.now?.() ?? new Date()).toISOString().slice(0, 19);
  const base = { "merchant-id": env.merchantId, version: "v1", timestamp };
  try {
    const res = await doFetch(`https://api.payfast.co.za/subscriptions/${token}/cancel${env.mode === "sandbox" ? "?testing=true" : ""}`, {
      method: "PUT",
      headers: { ...base, signature: payfastApiSignature(base, env.passphrase) },
    });
    return res.ok ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}
