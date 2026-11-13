import { z } from "zod";
import { PLANS } from "@/lib/plans";
import { payfastIps, payfastServerValidates } from "@/server/payments/checkout";
import { payfastAmountToCents } from "@/server/payments/amounts";
import { verifyPayfastItn } from "@/server/payments/payfast";
import { readBillingEnv } from "@/server/billing/payfast-subscription";
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
    expectedCents: status === "COMPLETE" ? PLANS.pro.priceCents : null,
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
    return Response.json({ outcome });
  } catch (e) {
    console.error("PayFast billing ITN not applied", { message: e instanceof Error ? e.message : "unknown" });
    // 500 so PayFast retries: the payment is real and must not be lost.
    return new Response("Not applied", { status: 500 });
  }
}
