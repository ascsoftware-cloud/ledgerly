import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  PAYFAST_FIELD_ORDER,
  payfastItnParamString,
  payfastSignature,
  phpUrlencode,
  verifyPayfastItn,
} from "./payfast";
import { verifyYocoWebhook } from "./yoco";
import { centsToPayfastAmount } from "./amounts";

describe("phpUrlencode (PayFast's encoding rules)", () => {
  test.each([
    ["Test Product", "Test+Product"],
    ["a&b=c", "a%26b%3Dc"],
    ["https://x.co/p?a=1", "https%3A%2F%2Fx.co%2Fp%3Fa%3D1"],
    ["keep-these_.", "keep-these_."],
    ["!'()*~", "%21%27%28%29%2A%7E"],
    ["café", "caf%C3%A9"],
  ])("%j → %s", (input, expected) => {
    expect(phpUrlencode(input)).toBe(expected);
  });
});

describe("payfastSignature", () => {
  const fields: [string, string][] = [
    ["merchant_id", "10000100"],
    ["merchant_key", "46f0cd694581a"],
    ["return_url", ""],
    ["amount", "100.00"],
    ["item_name", " Test Product "],
  ];
  const md5 = (s: string) => createHash("md5").update(s).digest("hex");

  test("joins non-blank fields in order, trimmed and encoded, then MD5", () => {
    expect(payfastSignature(fields)).toBe(md5("merchant_id=10000100&merchant_key=46f0cd694581a&amount=100.00&item_name=Test+Product"));
  });
  test("appends the passphrase last", () => {
    expect(payfastSignature(fields, "jt7NOE43FZPn")).toBe(
      md5("merchant_id=10000100&merchant_key=46f0cd694581a&amount=100.00&item_name=Test+Product&passphrase=jt7NOE43FZPn"),
    );
  });
  test("the field order follows PayFast's documented order, not alphabetical", () => {
    expect(PAYFAST_FIELD_ORDER.indexOf("merchant_id")).toBeLessThan(PAYFAST_FIELD_ORDER.indexOf("amount"));
    expect(PAYFAST_FIELD_ORDER.indexOf("amount")).toBeLessThan(PAYFAST_FIELD_ORDER.indexOf("item_name"));
    expect(PAYFAST_FIELD_ORDER.indexOf("notify_url")).toBeLessThan(PAYFAST_FIELD_ORDER.indexOf("m_payment_id"));
  });
});

describe("centsToPayfastAmount", () => {
  test.each([
    [10000, "100.00"],
    [5, "0.05"],
    [123456, "1234.56"],
  ])("%i → %s", (c, s) => expect(centsToPayfastAmount(c)).toBe(s));
});

describe("PayFast ITN checks", () => {
  const passphrase = "salt-and-vinegar";
  const posted = new URLSearchParams();
  posted.append("m_payment_id", "8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e");
  posted.append("pf_payment_id", "1089250");
  posted.append("payment_status", "COMPLETE");
  posted.append("item_name", "INV-0001");
  posted.append("item_description", "");
  posted.append("amount_gross", "200.00");
  posted.append("merchant_id", "10012577");
  const paramString = payfastItnParamString(posted);
  posted.append("signature", createHash("md5").update(`${paramString}&passphrase=${phpUrlencode(passphrase)}`).digest("hex"));

  const ok = {
    body: posted,
    passphrase,
    expectedCents: 20000,
    merchantId: "10012577",
    sourceIp: "41.74.179.194",
    validIps: ["41.74.179.194"],
    validateWithPayfast: async () => true,
  };

  test("the param string keeps PayFast's order and stops before the signature", () => {
    expect(paramString).toBe(
      "m_payment_id=8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e&pf_payment_id=1089250&payment_status=COMPLETE&item_name=INV-0001&item_description=&amount_gross=200.00&merchant_id=10012577",
    );
  });

  test("all four checks pass for a genuine notification", async () => {
    expect(await verifyPayfastItn(ok)).toEqual({ ok: true });
  });

  test.each([
    ["a tampered amount", { body: (() => { const b = new URLSearchParams(posted); b.set("amount_gross", "2.00"); return b; })() }, "signature"],
    ["the wrong passphrase", { passphrase: "nope" }, "signature"],
    ["an IP PayFast does not use", { sourceIp: "203.0.113.9" }, "source"],
    ["an amount that differs from the invoice", { expectedCents: 19999 }, "amount"],
    ["another merchant's notification", { merchantId: "99999999" }, "merchant"],
    ["PayFast's server not confirming it", { validateWithPayfast: async () => false }, "validate"],
  ])("refuses %s", async (_name, patch, reason) => {
    expect(await verifyPayfastItn({ ...ok, ...patch })).toEqual({ ok: false, reason });
  });
});

describe("Yoco webhook signature (Standard Webhooks)", () => {
  // Published test vector from the Standard Webhooks specification.
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
  const timestamp = "1614265330";
  const body = '{"test": 2432232314}';
  const signature = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
  const at = new Date(1614265330 * 1000);

  test("accepts the published vector", () => {
    expect(verifyYocoWebhook({ secret, id, timestamp, signature, body, now: at })).toEqual({ ok: true });
  });
  test("accepts it among several space-separated signatures", () => {
    expect(verifyYocoWebhook({ secret, id, timestamp, signature: `v1,bm9wZQ== ${signature}`, body, now: at })).toEqual({ ok: true });
  });
  test.each([
    ["a changed body", { body: '{"test": 1}' }, "signature"],
    ["a changed id", { id: "msg_other" }, "signature"],
    ["the wrong secret", { secret: "whsec_" + Buffer.from("other-secret").toString("base64") }, "signature"],
    ["a timestamp four minutes old", { now: new Date((1614265330 + 240) * 1000) }, "timestamp"],
    ["a timestamp from the future", { now: new Date((1614265330 - 240) * 1000) }, "timestamp"],
    ["missing headers", { signature: "" }, "headers"],
  ])("refuses %s", (_n, patch, reason) => {
    expect(verifyYocoWebhook({ secret, id, timestamp, signature, body, now: at, ...patch })).toEqual({ ok: false, reason });
  });
});
