import "server-only";
import { resolve4 } from "node:dns/promises";
import { z } from "zod";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { amountDueNow, centsToPayfastAmount } from "./amounts";
import { PAYFAST_FIELD_ORDER, PAYFAST_HOSTS, payfastSignature } from "./payfast";
import { randsToCents } from "@/server/integrations/http";
import * as stitch from "./stitch";

/**
 * Server-only payment plumbing. Uses the service role because a client paying an invoice
 * is not signed in, and the business's provider keys live in Vault. Every query here is
 * scoped by the document's own workspace and the connection that workspace owns.
 */

export type Provider = "yoco" | "payfast" | "stitch";

const secretsRow = z.object({
  workspace_id: z.uuid(),
  provider: z.enum(["yoco", "payfast", "stitch"]),
  mode: z.enum(["test", "live"]),
  merchant_id: z.string().nullable(),
  status: z.enum(["pending", "active", "disabled"]),
  secret: z.string().nullable(),
  passphrase: z.string().nullable(),
  webhook_secret: z.string().nullable(),
});
export type ConnectionSecrets = z.infer<typeof secretsRow>;

export async function connectionSecrets(connectionId: string): Promise<ConnectionSecrets | null> {
  if (!z.uuid().safeParse(connectionId).success) return null;
  const { data } = await createAdminClient().rpc("payment_connection_secrets", { p_connection: connectionId });
  const row = Array.isArray(data) ? data[0] : null;
  const parsed = secretsRow.safeParse(row);
  return parsed.success ? parsed.data : null;
}

/** Which card options to show on a public invoice. Never returns secrets. */
export async function availableProviders(token: string): Promise<Provider[]> {
  const db = createAdminClient();
  const { data: doc } = await db
    .from("sales_documents")
    .select("workspace_id, kind, status")
    .eq("public_token", token)
    .maybeSingle();
  if (!doc || doc.kind !== "invoice" || ["draft", "void", "paid"].includes(doc.status as string)) return [];
  const { data } = await db
    .from("payment_connections")
    .select("provider, webhook_id")
    .eq("workspace_id", doc.workspace_id)
    .eq("status", "active");
  return (data ?? [])
    // Yoco needs its webhook to confirm payments; PayFast and Stitch confirm on their own.
    .filter((c) => c.provider !== "yoco" || c.webhook_id)
    .map((c) => c.provider as Provider);
}

export type CheckoutStart =
  | { ok: true; kind: "redirect"; url: string }
  | { ok: true; kind: "form"; action: string; fields: [string, string][] }
  | { ok: false; message: string };

/** Creates a checkout for what is due now (deposit, or the balance), and hands back where to send the payer. */
export async function startCheckout(token: string, provider: Provider): Promise<CheckoutStart> {
  const db = createAdminClient();
  const { data: doc } = await db
    .from("sales_documents")
    .select("id, workspace_id, kind, status, number, total_cents, paid_cents, credited_cents, deposit_cents, public_token")
    .eq("public_token", token)
    .maybeSingle();
  if (!doc || doc.kind !== "invoice" || ["draft", "void", "paid"].includes(doc.status as string)) {
    return { ok: false, message: "This invoice can't be paid online." };
  }
  const { cents: balance } = amountDueNow({
    totalCents: Number(doc.total_cents),
    paidCents: Number(doc.paid_cents),
    creditedCents: Number(doc.credited_cents),
    depositCents: Number(doc.deposit_cents),
  });
  if (balance <= 0) return { ok: false, message: "This invoice is already paid." };

  const { data: conn } = await db
    .from("payment_connections")
    .select("id")
    .eq("workspace_id", doc.workspace_id)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();
  if (provider === "stitch") {
    return conn ? startStitchCheckout(doc, conn.id as string, balance) : { ok: false, message: "Pay by bank isn't set up for this business yet." };
  }
  const secrets = conn ? await connectionSecrets(conn.id as string) : null;
  if (!conn || !secrets?.secret || secrets.workspace_id !== doc.workspace_id) {
    return { ok: false, message: "Card payments aren't set up for this business yet." };
  }

  const { data: checkout, error } = await db
    .from("payment_checkouts")
    .insert({ workspace_id: doc.workspace_id, document_id: doc.id, connection_id: conn.id, provider, amount_cents: balance })
    .select("id")
    .single();
  if (error || !checkout) return { ok: false, message: "Couldn't start the payment. Try again." };

  const back = `${siteUrl()}/p/${doc.public_token}`;

  if (provider === "yoco") {
    const res = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secrets.secret}`,
        "Content-Type": "application/json",
        "Idempotency-Key": checkout.id as string,
      },
      body: JSON.stringify({
        amount: balance,
        currency: "ZAR",
        successUrl: `${back}?paid=1`,
        cancelUrl: back,
        failureUrl: `${back}?failed=1`,
        externalId: checkout.id,
        metadata: { ledgerlyRef: checkout.id, invoice: doc.number },
      }),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { id?: string; redirectUrl?: string }) : {};
    if (!res?.ok || !body.redirectUrl) {
      console.error("Yoco checkout failed", { status: res?.status });
      return { ok: false, message: "The card payment page didn't open. Try again in a moment." };
    }
    await db.from("payment_checkouts").update({ provider_checkout_id: body.id ?? null }).eq("id", checkout.id);
    return { ok: true, kind: "redirect", url: body.redirectUrl };
  }

  // PayFast: a signed form the browser posts to PayFast's hosted page.
  const values: Record<string, string> = {
    merchant_id: secrets.merchant_id ?? "",
    merchant_key: secrets.secret,
    return_url: `${back}?paid=1`,
    cancel_url: back,
    notify_url: `${siteUrl()}/api/webhooks/payfast/${conn.id}`,
    m_payment_id: checkout.id as string,
    amount: centsToPayfastAmount(balance),
    item_name: `Invoice ${doc.number}`,
  };
  const fields = PAYFAST_FIELD_ORDER.filter((k) => values[k]).map((k) => [k, values[k]!] as [string, string]);
  fields.push(["signature", payfastSignature(fields, secrets.passphrase)]);
  const host = secrets.mode === "live" ? "www.payfast.co.za" : "sandbox.payfast.co.za";
  return { ok: true, kind: "form", action: `https://${host}/eng/process`, fields };
}

/** Checkout amount and owner, for verifying a notification before applying it. */
export async function checkoutById(id: string, connectionId: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const { data } = await createAdminClient()
    .from("payment_checkouts")
    .select("id, amount_cents, connection_id")
    .eq("id", id)
    .eq("connection_id", connectionId)
    .maybeSingle();
  return data ? { id: data.id as string, amountCents: Number(data.amount_cents) } : null;
}

export async function checkoutByProviderId(providerCheckoutId: string, connectionId: string) {
  const { data } = await createAdminClient()
    .from("payment_checkouts")
    .select("id")
    .eq("provider_checkout_id", providerCheckoutId)
    .eq("connection_id", connectionId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function applyPaymentEvent(input: {
  connectionId: string;
  provider: Provider;
  eventId: string;
  checkoutId: string | null;
  amountCents: number;
  providerRef: string;
  payload: unknown;
}): Promise<string> {
  const { data, error } = await createAdminClient().rpc("apply_payment_event", {
    p_connection: input.connectionId,
    p_provider: input.provider,
    p_event_id: input.eventId,
    p_checkout: input.checkoutId,
    p_amount_cents: input.amountCents,
    p_provider_ref: input.providerRef,
    p_payload: input.payload,
  });
  if (error) throw new Error(`apply_payment_event failed: ${error.code}`);
  return String(data);
}

let ipCache: { at: number; ips: string[] } | null = null;
/** PayFast's current addresses, from DNS, cached for ten minutes. */
export async function payfastIps(): Promise<string[]> {
  if (ipCache && Date.now() - ipCache.at < 600_000) return ipCache.ips;
  const lists = await Promise.all(PAYFAST_HOSTS.map((h) => resolve4(h).catch(() => [] as string[])));
  ipCache = { at: Date.now(), ips: [...new Set(lists.flat())] };
  return ipCache.ips;
}

export async function payfastServerValidates(paramString: string, mode: "test" | "live"): Promise<boolean> {
  const host = mode === "live" ? "www.payfast.co.za" : "sandbox.payfast.co.za";
  const res = await fetch(`https://${host}/eng/query/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: paramString,
  }).catch(() => null);
  return res ? (await res.text()).trim() === "VALID" : false;
}

// ---------------------------------------------------------------------------
// Stitch (pay by bank). Same shape as Yoco: a checkout row, then a hosted page.
// ---------------------------------------------------------------------------
const stitchSecretsRow = z.object({
  workspace_id: z.uuid(),
  mode: z.enum(["test", "live"]),
  status: z.enum(["pending", "active", "disabled"]),
  client_id: z.string(),
  client_secret: z.string().nullable(),
  webhook_secret: z.string().nullable(),
});
export type StitchSecrets = z.infer<typeof stitchSecretsRow>;

export async function stitchSecrets(connectionId: string): Promise<StitchSecrets | null> {
  if (!z.uuid().safeParse(connectionId).success) return null;
  const { data } = await createAdminClient().rpc("stitch_connection_secrets", { p_connection: connectionId });
  const parsed = stitchSecretsRow.safeParse(Array.isArray(data) ? data[0] : null);
  return parsed.success ? parsed.data : null;
}

/** Stitch asks for tokens to be cached until they expire: generating one is slow. */
const stitchTokens = new Map<string, { token: string; until: number }>();

async function stitchToken(connectionId: string, s: StitchSecrets): Promise<string | null> {
  const cached = stitchTokens.get(connectionId);
  if (cached && cached.until > Date.now()) return cached.token;
  if (!s.client_secret) return null;
  const res = await fetch(stitch.STITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: stitch.tokenBody(s.client_id, s.client_secret),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  const parsed = stitch.tokenResponse.safeParse(body);
  if (!res?.ok || !parsed.success) {
    console.error("Stitch token failed", { status: res?.status });
    return null;
  }
  stitchTokens.set(connectionId, { token: parsed.data.access_token, until: Date.now() + (parsed.data.expires_in - 60) * 1000 });
  return parsed.data.access_token;
}

async function startStitchCheckout(
  doc: { id: unknown; workspace_id: unknown; number: unknown; public_token: unknown },
  connectionId: string,
  balance: number,
): Promise<CheckoutStart> {
  const db = createAdminClient();
  const s = await stitchSecrets(connectionId);
  if (!s || s.status !== "active" || s.workspace_id !== doc.workspace_id) {
    return { ok: false, message: "Pay by bank isn't set up for this business yet." };
  }
  const token = await stitchToken(connectionId, s);
  if (!token) return { ok: false, message: "The bank payment page didn't open. Try again in a moment." };

  const { data: checkout, error } = await db
    .from("payment_checkouts")
    .insert({ workspace_id: doc.workspace_id, document_id: doc.id, connection_id: connectionId, provider: "stitch", amount_cents: balance })
    .select("id")
    .single();
  if (error || !checkout) return { ok: false, message: "Couldn't start the payment. Try again." };

  const res = await fetch(`${stitch.STITCH_API}/payment-requests`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(
      stitch.paymentRequestBody({
        amountCents: balance,
        invoiceNumber: String(doc.number ?? ""),
        checkoutId: checkout.id as string,
        // The payer is the invoice: Stitch only needs a stable id, never personal details here.
        payerId: String(doc.id),
        expireAt: new Date(Date.now() + 24 * 3600_000),
      }),
    ),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  const pr = stitch.parsePaymentRequest(res ? await res.json().catch(() => null) : null);
  if (!res?.ok || !pr?.interaction?.url) {
    console.error("Stitch payment request failed", { status: res?.status });
    return { ok: false, message: "The bank payment page didn't open. Try again in a moment." };
  }
  await db.from("payment_checkouts").update({ provider_checkout_id: pr.id }).eq("id", checkout.id);
  const back = `${siteUrl()}/api/webhooks/stitch/${connectionId}/return?checkout=${checkout.id}`;
  const url = stitch.payerUrl(pr.interaction.url, back, `${siteUrl()}/p/${doc.public_token}?failed=1`);
  if (!url) return { ok: false, message: "The bank payment page didn't open. Try again in a moment." };
  return { ok: true, kind: "redirect", url };
}

/**
 * Asks Stitch for the payment request's status and applies it if completed. Used when the payer
 * comes back (the redirect's own "status" is never trusted) and as a webhook fallback.
 */
export async function confirmStitchCheckout(connectionId: string, checkoutId: string): Promise<{ outcome: string; token: string | null }> {
  if (!z.uuid().safeParse(checkoutId).success) return { outcome: "rejected: bad checkout", token: null };
  const db = createAdminClient();
  const { data: co } = await db
    .from("payment_checkouts")
    .select("id, connection_id, provider, provider_checkout_id, amount_cents, sales_documents(public_token)")
    .eq("id", checkoutId)
    .eq("connection_id", connectionId)
    .eq("provider", "stitch")
    .maybeSingle();
  const token = ((co?.sales_documents as { public_token?: string } | null)?.public_token as string | undefined) ?? null;
  if (!co?.provider_checkout_id) return { outcome: "rejected: unknown checkout", token };
  const s = await stitchSecrets(connectionId);
  const access = s ? await stitchToken(connectionId, s) : null;
  if (!access) return { outcome: "unavailable", token };
  const res = await fetch(`${stitch.STITCH_API}/payment-requests/${encodeURIComponent(co.provider_checkout_id as string)}`, {
    headers: { Authorization: `Bearer ${access}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const pr = stitch.parsePaymentRequest(res ? await res.json().catch(() => null) : null);
  if (!res?.ok || !pr) return { outcome: "unavailable", token };
  if (!stitch.isCompleted(pr.status)) return { outcome: `not paid (${pr.status})`, token };
  if (pr.externalReference && pr.externalReference !== co.id) return { outcome: "rejected: reference mismatch", token };
  const amountCents = pr.amount ? (randsToCents(pr.amount.quantity) ?? -1) : Number(co.amount_cents);
  const outcome = await applyPaymentEvent({
    connectionId,
    provider: "stitch",
    eventId: `return:${pr.id}`,
    checkoutId: co.id as string,
    amountCents,
    providerRef: pr.id,
    payload: { source: "return", payment: pr.id, status: pr.status },
  });
  return { outcome, token };
}
