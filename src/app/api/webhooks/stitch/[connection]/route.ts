import { z } from "zod";
import { applyPaymentEvent, checkoutById, stitchSecrets } from "@/server/payments/checkout";
import { randsToCents } from "@/server/integrations/http";
import { parsePaymentWebhook, verifyStitchWebhook } from "@/server/payments/stitch";

/**
 * Stitch posts `payment` webhooks here for one business's connection, signed the Svix way.
 * Order matters: verify the signature on the raw body first, then match our checkout, then apply once.
 * Verified-but-irrelevant events (cancelled, expired, other types) get 200 so Stitch stops retrying.
 */
export async function POST(
  req: Request,
  { params }: RouteContext<"/api/webhooks/stitch/[connection]">,
) {
  const { connection } = await params;
  const body = await req.text();
  const secrets = await stitchSecrets(connection);
  if (!secrets?.webhook_secret) return new Response("Unknown connection", { status: 404 });

  const id = req.headers.get("svix-id") ?? req.headers.get("webhook-id");
  const check = verifyStitchWebhook({
    secret: secrets.webhook_secret,
    id,
    timestamp: req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp"),
    signature: req.headers.get("svix-signature") ?? req.headers.get("webhook-signature"),
    body,
  });
  if (!check.ok) return new Response(`Invalid webhook: ${check.reason}`, { status: 401 });

  let parsed: ReturnType<typeof parsePaymentWebhook>;
  try {
    parsed = parsePaymentWebhook(JSON.parse(body));
  } catch {
    return new Response("Unexpected payload", { status: 400 });
  }
  if (!parsed) return Response.json({ ignored: "not a payment event" });
  if (!parsed.completed) return Response.json({ ignored: parsed.state });
  if (parsed.amount && parsed.amount.currency !== "ZAR")
    return Response.json({ ignored: "currency" });

  const checkoutId =
    parsed.checkoutId && z.uuid().safeParse(parsed.checkoutId).success ? parsed.checkoutId : null;
  const checkout = checkoutId ? await checkoutById(checkoutId, connection) : null;
  const amountCents = parsed.amount
    ? randsToCents(parsed.amount.quantity)
    : (checkout?.amountCents ?? null);

  const outcome = await applyPaymentEvent({
    connectionId: connection,
    provider: "stitch",
    eventId: id ?? parsed.paymentRequestId,
    checkoutId,
    amountCents: amountCents ?? -1,
    providerRef: parsed.paymentRequestId,
    payload: {
      type: "payment",
      payment: parsed.paymentRequestId,
      state: parsed.state,
      mode: secrets.mode,
    },
  });
  return Response.json({ outcome });
}
