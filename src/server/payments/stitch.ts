import { z } from "zod";
import { verifyYocoWebhook, type WebhookCheck } from "./yoco";

/**
 * Stitch (stitch.money): client-credentials token, REST payment requests, and Svix-signed
 * webhooks. Verified against docs.stitch.money on 2026-11-12:
 *  - token: POST https://secure.stitch.money/connect/token, form body, scope client_paymentrequest,
 *    audience = the token URL; tokens last `expires_in` seconds (3600 in the docs' example).
 *  - create: POST https://api.stitch.money/v2/payment-requests → 201 { id, status, interaction.url }.
 *  - status: GET https://api.stitch.money/v2/payment-requests/{id} → status completed|pending|cancelled|expired.
 *  - the payer goes to interaction.url with redirect_uri (and failure_redirect_uri) appended.
 *  - webhooks are signed the Svix way, which is Standard Webhooks: the same check as Yoco,
 *    with svix-id / svix-timestamp / svix-signature headers.
 * The same hosts serve test and live clients; the client id decides which.
 */

export const STITCH_TOKEN_URL = "https://secure.stitch.money/connect/token";
export const STITCH_API = "https://api.stitch.money/v2";

export function tokenBody(clientId: string, clientSecret: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "client_paymentrequest",
    audience: STITCH_TOKEN_URL,
  });
}

export const tokenResponse = z.object({
  access_token: z.string().min(10),
  expires_in: z.number().int().positive(),
});

/**
 * Payer references show on bank statements: Pay by Bank allows 12 characters, beneficiary 20.
 * The money goes to the beneficiary set up on the business's own Stitch client.
 */
function reference(s: string, max: number): string {
  return (
    s
      .replace(/[^A-Za-z0-9 -]/g, "")
      .trim()
      .slice(0, max) || "Invoice"
  );
}

export function paymentRequestBody(input: {
  amountCents: number;
  invoiceNumber: string;
  checkoutId: string;
  payerId: string;
  expireAt: Date;
}) {
  return {
    amount: { quantity: input.amountCents / 100, currency: "ZAR" },
    externalReference: input.checkoutId,
    expireAt: input.expireAt.toISOString(),
    payer: { identifier: input.payerId },
    paymentMethods: {
      eft: {
        enabled: true,
        payerReference: reference(input.invoiceNumber, 12),
        beneficiaryReference: reference(input.invoiceNumber, 20),
      },
      // Card and Capitec Pay need Stitch to switch them on for the client first; requesting a
      // method the client does not have is refused, so only Pay by Bank is asked for.
    },
  };
}

const paymentRequest = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: z
    .object({ quantity: z.union([z.number(), z.string()]), currency: z.string() })
    .optional(),
  externalReference: z.string().nullish(),
  interaction: z.object({ type: z.string().optional(), url: z.string() }).optional(),
});
export type StitchPaymentRequest = z.infer<typeof paymentRequest>;

export function parsePaymentRequest(body: unknown): StitchPaymentRequest | null {
  const p = paymentRequest.safeParse(body);
  return p.success ? p.data : null;
}

/** Where to send the payer: Stitch's page plus our return addresses. Only Stitch's host is trusted. */
export function payerUrl(
  interactionUrl: string,
  redirectUri: string,
  failureUri: string,
): string | null {
  let u: URL;
  try {
    u = new URL(interactionUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !/(^|\.)stitch\.money$/.test(u.hostname)) return null;
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("failure_redirect_uri", failureUri);
  return u.toString();
}

/** The API says "completed"; redirects say "complete". Only the API's word counts for money. */
export function isCompleted(status: string): boolean {
  return status.toLowerCase() === "completed";
}

export function verifyStitchWebhook(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: Date;
}): WebhookCheck {
  return verifyYocoWebhook(input);
}

const webhookPayload = z.object({
  data: z.object({
    client: z.object({
      paymentInitiationRequests: z.object({
        node: z.object({
          id: z.string(),
          externalReference: z.string().nullish(),
          amount: z
            .object({ quantity: z.union([z.number(), z.string()]), currency: z.string() })
            .optional(),
          state: z.object({ __typename: z.string() }),
        }),
      }),
    }),
  }),
});

/** The `payment` webhook: which payment request, which of our checkouts, and whether it completed. */
export function parsePaymentWebhook(body: unknown) {
  const p = webhookPayload.safeParse(body);
  if (!p.success) return null;
  const node = p.data.data.client.paymentInitiationRequests.node;
  return {
    paymentRequestId: node.id,
    checkoutId: node.externalReference ?? null,
    state: node.state.__typename,
    completed: node.state.__typename === "PaymentInitiationRequestCompleted",
    amount: node.amount ?? null,
  };
}
