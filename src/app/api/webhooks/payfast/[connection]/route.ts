import {
  applyPaymentEvent,
  checkoutById,
  connectionSecrets,
  payfastIps,
  payfastServerValidates,
} from "@/server/payments/checkout";
import { payfastAmountToCents } from "@/server/payments/amounts";
import { verifyPayfastItn } from "@/server/payments/payfast";

function sourceIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
}

/**
 * PayFast ITN for one business's connection. All four of PayFast's checks must pass
 * before anything is applied; then the payment is applied once per pf_payment_id.
 */
export async function POST(req: Request, { params }: RouteContext<"/api/webhooks/payfast/[connection]">) {
  const { connection } = await params;
  const body = new URLSearchParams(await req.text());
  const secrets = await connectionSecrets(connection);
  if (!secrets || secrets.provider !== "payfast" || !secrets.merchant_id) {
    return new Response("Unknown connection", { status: 404 });
  }

  const checkout = await checkoutById(body.get("m_payment_id") ?? "", connection);
  if (!checkout) return new Response("Unknown payment", { status: 400 });

  const check = await verifyPayfastItn({
    body,
    passphrase: secrets.passphrase,
    expectedCents: checkout.amountCents,
    merchantId: secrets.merchant_id,
    sourceIp: sourceIp(req),
    validIps: await payfastIps(),
    validateWithPayfast: (paramString) => payfastServerValidates(paramString, secrets.mode),
  });
  if (!check.ok) {
    console.warn("PayFast ITN refused", { reason: check.reason });
    return new Response(`Refused: ${check.reason}`, { status: 400 });
  }

  if (body.get("payment_status") !== "COMPLETE") return Response.json({ ignored: body.get("payment_status") });

  const pfId = body.get("pf_payment_id") ?? "";
  const outcome = await applyPaymentEvent({
    connectionId: connection,
    provider: "payfast",
    eventId: `itn:${pfId}`,
    checkoutId: checkout.id,
    amountCents: payfastAmountToCents(body.get("amount_gross")) ?? 0,
    providerRef: pfId,
    payload: { pf_payment_id: pfId, status: body.get("payment_status"), amount_gross: body.get("amount_gross"), mode: secrets.mode },
  });
  return Response.json({ outcome });
}
