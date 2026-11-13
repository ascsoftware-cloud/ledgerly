import { z } from "zod";
import { log } from "@/lib/ops/log";
import { reportError } from "@/lib/ops/report";
import { payfastIps, payfastServerValidates } from "@/server/payments/checkout";
import { payfastAmountToCents } from "@/server/payments/amounts";
import { verifyPayfastItn } from "@/server/payments/payfast";
import { cancelPayfastSubscription, readBillingEnv } from "@/server/billing/payfast-subscription";
import { applyPayment, setCancelling } from "@/server/billing/service";

function sourceIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
}

/**
 * PayFast's notification for Ledgerly Pro subscriptions (our own merchant account, not a business's). All of
 * PayFast's checks must pass before anything changes: signature, PayFast's own address, our merchant id, the
 * exact price, and PayFast confirming the notification. A payment is then applied once per pf_payment_id.
 */
export async function POST(req: Request) {
  const env = readBillingEnv();
  if (!env) return new Response("Billing is not set up", { status: 503 });
  const body = new URLSearchParams(await req.text());
  const status = body.get("payment_status");

  const check = await verifyPayfastItn({
    body,
    passphrase: env.passphrase,
    // The amount is checked in the database against what this checkout or subscription costs (so an existing
    // subscriber's renewals keep working if the price is ever changed for new ones).
    expectedCents: null,
    merchantId: env.merchantId,
    sourceIp: sourceIp(req),
    validIps: await payfastIps(),
    validateWithPayfast: (paramString) => payfastServerValidates(paramString, env.mode === "live" ? "live" : "test"),
  });
  if (!check.ok) {
    console.warn("PayFast billing ITN refused", { reason: check.reason });
    return new Response(`Refused: ${check.reason}`, { status: 400 });
  }

  const token = body.get("token")?.trim() || null;
  if (status === "CANCELLED") {
    if (!token) return Response.json({ ignored: "no token" });
    return Response.json({ cancelling: await setCancelling({ token }) });
  }
  if (status !== "COMPLETE") return Response.json({ ignored: status });

  const checkoutId = z.uuid().safeParse(body.get("m_payment_id") ?? "");
  const pfPaymentId = body.get("pf_payment_id") ?? "";
  const cents = payfastAmountToCents(body.get("amount_gross"));
  if (!pfPaymentId || cents === null) return new Response("Bad notification", { status: 400 });
  try {
    const outcome = await applyPayment({ checkoutId: checkoutId.success ? checkoutId.data : null, token, pfPaymentId, amountCents: cents });
    if (outcome === "extra_subscription" && token) {
      // The business already had a subscription: stop this second one so it is not charged twice every month.
      const stopped = await cancelPayfastSubscription(token, env);
      log.error("billing_extra_subscription", { pfPaymentId, cancelledAtPayfast: stopped.ok });
      await reportError({ error: new Error("A second PayFast subscription was started for a business that already has one"), route: "/api/webhooks/payfast-billing", method: "POST" });
    }
    if (outcome === "unknown") {
      // A real, verified payment that matches nothing we know: never drop it silently.
      log.error("billing_payment_unknown", { pfPaymentId, amountCents: cents });
      await reportError({ error: new Error("A verified PayFast payment did not match any checkout or subscription"), route: "/api/webhooks/payfast-billing", method: "POST" });
    }
    return Response.json({ outcome });
  } catch (e) {
    console.error("PayFast billing ITN not applied", { message: e instanceof Error ? e.message : "unknown" });
    // 500 so PayFast retries: the payment is real and must not be lost.
    return new Response("Not applied", { status: 500 });
  }
}
