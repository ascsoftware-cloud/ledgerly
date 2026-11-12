import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import * as stitch from "./stitch";

describe("Stitch", () => {
  test("token request uses client credentials with the payment-request scope", () => {
    const b = stitch.tokenBody("test-client", "secret-value");
    expect(Object.fromEntries(b)).toEqual({
      grant_type: "client_credentials",
      client_id: "test-client",
      client_secret: "secret-value",
      scope: "client_paymentrequest",
      audience: "https://secure.stitch.money/connect/token",
    });
  });

  test("payment request: amount in rands, our checkout id as the reference, bank-safe references", () => {
    const body = stitch.paymentRequestBody({
      amountCents: 115050,
      invoiceNumber: "INV-0007/2026",
      checkoutId: "co-1",
      payerId: "doc-1",
      expireAt: new Date("2026-11-13T00:00:00Z"),
    });
    expect(body).toEqual({
      amount: { quantity: 1150.5, currency: "ZAR" },
      externalReference: "co-1",
      expireAt: "2026-11-13T00:00:00.000Z",
      payer: { identifier: "doc-1" },
      paymentMethods: {
        eft: {
          enabled: true,
          payerReference: "INV-00072026",
          beneficiaryReference: "INV-00072026",
        },
      },
    });
    expect(body.paymentMethods.eft.payerReference.length).toBeLessThanOrEqual(12);
  });

  test("the payer is only ever sent to Stitch's own host", () => {
    const ok = stitch.payerUrl(
      "https://secure.stitch.money/connect/payment-request/abc",
      "https://l.test/back",
      "https://l.test/fail",
    );
    expect(new URL(ok!).searchParams.get("redirect_uri")).toBe("https://l.test/back");
    expect(new URL(ok!).searchParams.get("failure_redirect_uri")).toBe("https://l.test/fail");
    expect(stitch.payerUrl("https://evil.example.com/pay", "a", "b")).toBeNull();
    expect(stitch.payerUrl("http://secure.stitch.money/x", "a", "b")).toBeNull();
    expect(stitch.payerUrl("not a url", "a", "b")).toBeNull();
  });

  test("only the API's 'completed' counts as paid", () => {
    expect(stitch.isCompleted("completed")).toBe(true);
    expect(stitch.isCompleted("complete")).toBe(false);
    expect(stitch.isCompleted("pending")).toBe(false);
  });

  test("parses the payment webhook", () => {
    const payload = {
      data: {
        client: {
          paymentInitiationRequests: {
            node: {
              __typename: "PaymentInitiationRequest",
              id: "cGF5cmVxLzE=",
              externalReference: "co-1",
              amount: { currency: "ZAR", quantity: "1150.5" },
              state: {
                __typename: "PaymentInitiationRequestCompleted",
                date: "2026-11-12T10:00:00Z",
              },
            },
          },
        },
      },
    };
    expect(stitch.parsePaymentWebhook(payload)).toEqual({
      paymentRequestId: "cGF5cmVxLzE=",
      checkoutId: "co-1",
      state: "PaymentInitiationRequestCompleted",
      completed: true,
      amount: { currency: "ZAR", quantity: "1150.5" },
    });
    expect(stitch.parsePaymentWebhook({ type: "refund" })).toBeNull();
  });

  test("Svix signatures: valid accepted, tampered and stale rejected", () => {
    const key = Buffer.from("stitch-test-signing-key-123456").toString("base64");
    const secret = `whsec_${key}`;
    const id = "msg_2abc";
    const ts = "1794496000";
    const body = '{"data":{}}';
    const sig = createHmac("sha256", Buffer.from(key, "base64"))
      .update(`${id}.${ts}.${body}`)
      .digest("base64");
    const now = new Date(Number(ts) * 1000);
    expect(
      stitch.verifyStitchWebhook({ secret, id, timestamp: ts, signature: `v1,${sig}`, body, now }),
    ).toEqual({ ok: true });
    expect(
      stitch.verifyStitchWebhook({
        secret,
        id,
        timestamp: ts,
        signature: `v1,${sig}`,
        body: '{"data":1}',
        now,
      }).ok,
    ).toBe(false);
    expect(
      stitch.verifyStitchWebhook({
        secret,
        id,
        timestamp: ts,
        signature: `v1,${sig}`,
        body,
        now: new Date(now.getTime() + 600_000),
      }),
    ).toEqual({ ok: false, reason: "timestamp" });
  });
});
