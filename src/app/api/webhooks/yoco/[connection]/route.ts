import { z } from "zod";
import { applyPaymentEvent, checkoutByProviderId, connectionSecrets } from "@/server/payments/checkout";
import { verifyYocoWebhook } from "@/server/payments/yoco";

const event = z.object({
  id: z.string().optional(),
  type: z.string(),
  payload: z.object({
    id: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    status: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
});

/**
 * Yoco posts here for one business's connection. Order matters: verify the signature on the
 * raw body first, then match the payment to a checkout we created, then apply it once.
 * Verified-but-rejected events still get 200 so Yoco stops retrying; they are logged.
 */
export async function POST(req: Request, { params }: RouteContext<"/api/webhooks/yoco/[connection]">) {
  const { connection } = await params;
  const body = await req.text();
  const secrets = await connectionSecrets(connection);
  if (!secrets || secrets.provider !== "yoco" || !secrets.webhook_secret) {
    return new Response("Unknown connection", { status: 404 });
  }

  const check = verifyYocoWebhook({
    secret: secrets.webhook_secret,
    id: req.headers.get("webhook-id"),
    timestamp: req.headers.get("webhook-timestamp"),
    signature: req.headers.get("webhook-signature"),
    body,
  });
  if (!check.ok) return new Response(`Invalid webhook: ${check.reason}`, { status: 401 });

  let parsed: z.infer<typeof event>;
  try {
    parsed = event.parse(JSON.parse(body));
  } catch {
    return new Response("Unexpected payload", { status: 400 });
  }
  if (parsed.type !== "payment.succeeded" || parsed.payload.currency !== "ZAR") {
    return Response.json({ ignored: parsed.type });
  }

  const meta = parsed.payload.metadata ?? {};
  let checkoutId = typeof meta.ledgerlyRef === "string" ? meta.ledgerlyRef : null;
  if (!checkoutId && typeof meta.checkoutId === "string") {
    checkoutId = await checkoutByProviderId(meta.checkoutId, connection);
  }

  const outcome = await applyPaymentEvent({
    connectionId: connection,
    provider: "yoco",
    eventId: req.headers.get("webhook-id") ?? parsed.id ?? parsed.payload.id,
    checkoutId: checkoutId && z.uuid().safeParse(checkoutId).success ? checkoutId : null,
    amountCents: parsed.payload.amount,
    providerRef: parsed.payload.id,
    payload: { type: parsed.type, payment: parsed.payload.id, amount: parsed.payload.amount, mode: secrets.mode },
  });
  return Response.json({ outcome });
}
