import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { PLANS, formatBytes, formatPrice, storageLimitBytes } from "@/lib/plans";
import { buildSubscriptionForm, cancelPayfastSubscription, payfastApiSignature, readBillingEnv } from "./payfast-subscription";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");

describe("plans", () => {
  test("sizes read in plain words", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1,5 GB");
  });
  test("Pro is R199 a month, in cents, and the same number drives the price shown", () => {
    expect(PLANS.pro.priceCents).toBe(19900);
    expect(formatPrice(PLANS.pro.priceCents)).toBe("R199");
    expect(formatPrice(PLANS.free.priceCents)).toBe("R0");
  });
  test("limits match the spec: Free 10 documents, 200 MB, 20 AI; Pro unlimited documents, 10 GB, 300 AI", () => {
    expect(PLANS.free).toMatchObject({ documentsPerMonth: 10, storageMb: 200, aiPerMonth: 20 });
    expect(PLANS.pro).toMatchObject({ documentsPerMonth: null, storageMb: 10_000, aiPerMonth: 300 });
    expect(storageLimitBytes("free")).toBe(200 * 1024 * 1024);
    expect(storageLimitBytes("pro")).toBe(10_000 * 1024 * 1024);
  });
  test("only Pro has automations, the portal, no footer and extra workspaces", () => {
    expect(PLANS.free).toMatchObject({ automations: false, portal: false, hidesFooter: false, extraWorkspaces: false });
    expect(PLANS.pro).toMatchObject({ automations: true, portal: true, hidesFooter: true, extraWorkspaces: true });
  });
});

const env = { merchantId: "10000100", merchantKey: "46f0cd694581a", passphrase: "a secret phrase", mode: "sandbox" as const };

describe("the PayFast subscription form", () => {
  const form = buildSubscriptionForm({
    env,
    checkoutId: "11111111-2222-3333-4444-555555555555",
    amountCents: 19900,
    email: "owner@example.co.za",
    nameFirst: "Thandi",
    itemName: "Ledgerly Pro",
    returnUrl: "https://app.test/ws/settings/plan?paid=1",
    cancelUrl: "https://app.test/ws/settings/plan",
    notifyUrl: "https://app.test/api/webhooks/payfast-billing",
    billingDate: "2026-11-13",
  });
  const names = form.fields.map(([k]) => k);

  test("posts to the sandbox or live PayFast page according to the mode", () => {
    expect(form.action).toBe("https://sandbox.payfast.co.za/eng/process");
    expect(buildSubscriptionForm({ ...{ env: { ...env, mode: "live" as const } }, checkoutId: "x", amountCents: 19900, email: "a@b.co", nameFirst: "A", itemName: "i", returnUrl: "r", cancelUrl: "c", notifyUrl: "n", billingDate: "2026-11-13" }).action).toBe("https://www.payfast.co.za/eng/process");
  });
  test("is a monthly subscription that runs until cancelled, for the exact price", () => {
    const get = (k: string) => form.fields.find(([n]) => n === k)?.[1];
    expect(get("subscription_type")).toBe("1");
    expect(get("frequency")).toBe("3");
    expect(get("cycles")).toBe("0");
    expect(get("amount")).toBe("199.00");
    expect(get("recurring_amount")).toBe("199.00");
    expect(get("billing_date")).toBe("2026-11-13");
    expect(get("m_payment_id")).toBe("11111111-2222-3333-4444-555555555555");
  });
  test("lists fields in PayFast's order, subscription fields after payment_method, signature last", () => {
    const order = ["merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url", "name_first", "email_address", "m_payment_id", "amount", "item_name", "subscription_type", "billing_date", "recurring_amount", "frequency", "cycles", "signature"];
    expect(names).toEqual(order);
  });
  test("the signature is the MD5 of the encoded fields in that order, then the passphrase", () => {
    const parts = form.fields.filter(([k]) => k !== "signature").map(([k, v]) => `${k}=${enc(v)}`);
    expect(form.fields.at(-1)![1]).toBe(md5(`${parts.join("&")}&passphrase=${enc(env.passphrase)}`));
  });
});

describe("the PayFast API signature", () => {
  test("is the MD5 of the header values and passphrase, sorted by name", () => {
    const headers = { "merchant-id": "10000100", version: "v1", timestamp: "2026-11-13T10:00:00" };
    const sig = payfastApiSignature(headers, "a secret phrase");
    expect(sig).toBe(md5(`merchant-id=10000100&passphrase=${enc("a secret phrase")}&timestamp=${enc("2026-11-13T10:00:00")}&version=v1`));
  });
});

describe("cancelling at PayFast", () => {
  test("sends a signed PUT to the subscription's cancel address (sandbox adds testing=true)", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const r = await cancelPayfastSubscription("tok-123", env, {
      now: () => new Date("2026-11-13T10:00:00Z"),
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(JSON.stringify({ code: 200, status: "success" }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(r).toEqual({ ok: true });
    expect(seen!.url).toBe("https://api.payfast.co.za/subscriptions/tok-123/cancel?testing=true");
    expect(seen!.init.method).toBe("PUT");
    const h = seen!.init.headers as Record<string, string>;
    expect(h["merchant-id"]).toBe("10000100");
    expect(h.version).toBe("v1");
    expect(h.signature).toBe(payfastApiSignature({ "merchant-id": h["merchant-id"]!, version: h.version!, timestamp: h.timestamp! }, env.passphrase));
  });
  test("live mode has no testing flag", async () => {
    let url = "";
    await cancelPayfastSubscription("t", { ...env, mode: "live" }, { fetch: (async (u: string) => ((url = u), new Response("{}", { status: 200 }))) as unknown as typeof fetch });
    expect(url).toBe("https://api.payfast.co.za/subscriptions/t/cancel");
  });
  test("a refusal or an unreachable PayFast is a plain failure, with no secrets in it", async () => {
    const refused = await cancelPayfastSubscription("t", env, { fetch: (async () => new Response("bad key a secret phrase", { status: 401 })) as unknown as typeof fetch });
    expect(refused.ok).toBe(false);
    const down = await cancelPayfastSubscription("t", env, { fetch: (async () => { throw new Error("boom a secret phrase"); }) as unknown as typeof fetch });
    expect(down.ok).toBe(false);
    for (const r of [refused, down]) expect(JSON.stringify(r)).not.toContain("a secret phrase");
  });
  test("a token that is not plain is refused before anything is sent", async () => {
    let called = false;
    const r = await cancelPayfastSubscription("../../merchants", env, { fetch: (async () => ((called = true), new Response("{}"))) as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("readBillingEnv", () => {
  test("is null until every PayFast value is set, and reads the mode", () => {
    expect(readBillingEnv({})).toBeNull();
    expect(readBillingEnv({ PAYFAST_MERCHANT_ID: "1", PAYFAST_MERCHANT_KEY: "k" })).toBeNull();
    expect(readBillingEnv({ PAYFAST_MERCHANT_ID: "1", PAYFAST_MERCHANT_KEY: "k", PAYFAST_PASSPHRASE: "p" })).toEqual({ merchantId: "1", merchantKey: "k", passphrase: "p", mode: "sandbox" });
    expect(readBillingEnv({ PAYFAST_MERCHANT_ID: "1", PAYFAST_MERCHANT_KEY: "k", PAYFAST_PASSPHRASE: "p", PAYFAST_MODE: "live" })?.mode).toBe("live");
  });
});

import { verifyPayfastItn } from "@/server/payments/payfast";

describe("verifying a billing notification", () => {
  const pass = "a secret phrase";
  function signed(fields: Record<string, string>) {
    const parts = Object.entries(fields).map(([k, v]) => `${k}=${enc(v)}`).join("&");
    const body = new URLSearchParams(fields);
    body.set("signature", md5(`${parts}&passphrase=${enc(pass)}`));
    return body;
  }
  const base = { passphrase: pass, merchantId: "10000100", sourceIp: "1.2.3.4", validIps: ["1.2.3.4"], validateWithPayfast: async () => true };

  test("a payment must be for the exact price", async () => {
    const body = signed({ merchant_id: "10000100", payment_status: "COMPLETE", amount_gross: "199.00", token: "t" });
    expect(await verifyPayfastItn({ ...base, body, expectedCents: 19900 })).toEqual({ ok: true });
    expect(await verifyPayfastItn({ ...base, body, expectedCents: 29900 })).toEqual({ ok: false, reason: "amount" });
  });
  test("a cancellation has no payment, so the amount is not checked, but everything else still is", async () => {
    const body = signed({ merchant_id: "10000100", payment_status: "CANCELLED", token: "t" });
    expect(await verifyPayfastItn({ ...base, body, expectedCents: null })).toEqual({ ok: true });
    expect(await verifyPayfastItn({ ...base, body, expectedCents: null, merchantId: "99999999" })).toEqual({ ok: false, reason: "merchant" });
    expect(await verifyPayfastItn({ ...base, body, expectedCents: null, sourceIp: "6.6.6.6" })).toEqual({ ok: false, reason: "source" });
    expect(await verifyPayfastItn({ ...base, body, expectedCents: null, validateWithPayfast: async () => false })).toEqual({ ok: false, reason: "validate" });
    const forged = new URLSearchParams(body);
    forged.set("token", "someone-elses");
    expect(await verifyPayfastItn({ ...base, body: forged, expectedCents: null })).toEqual({ ok: false, reason: "signature" });
  });
});
