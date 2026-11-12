"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { siteUrl } from "@/lib/site-url";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { sendErrorMessage } from "@/features/sales/status";
import { bankDetailsSchema, manualPaymentSchema, MAX_PROOF_BYTES, payfastSchema, PROOF_TYPES, yocoSchema } from "./schema";

export type FormResult = { status: "idle" } | { status: "saved"; message: string; first?: boolean } | { status: "error"; message: string };

async function managers(slug: string) {
  const ctx = await requireWorkspace(slug);
  return ctx.role === "owner" || ctx.role === "admin" ? ctx : null;
}

function first<T>(r: z.ZodSafeParseResult<T>): string {
  return r.success ? "" : (r.error.issues[0]?.message ?? "Check the form.");
}

export async function saveBankDetails(slug: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const parsed = bankDetailsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { status: "error", message: first(parsed) };
  const ctx = await managers(slug);
  if (!ctx) return { status: "error", message: "Only owners and admins can change payment details." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("workspace_settings")
    .update({ bank_details: parsed.data })
    .eq("workspace_id", ctx.workspace.id);
  if (error) return { status: "error", message: "Couldn't save your bank details." };
  revalidatePath(`/${slug}/settings/payments`);
  return { status: "saved", message: "Bank details saved. They now show on your invoices." };
}

export async function connectYoco(slug: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const parsed = yocoSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { status: "error", message: first(parsed) };
  const ctx = await managers(slug);
  if (!ctx) return { status: "error", message: "Only owners and admins can connect Yoco." };
  const key = parsed.data.secretKey;
  const mode = key.startsWith("sk_live_") ? "live" : "test";
  const supabase = await createServerClient();

  const { data: connectionId, error } = await supabase.rpc("connect_payment_provider", {
    p_workspace: ctx.workspace.id,
    p_provider: "yoco",
    p_mode: mode,
    p_merchant_id: null,
    p_secret: key,
    p_passphrase: null,
  });
  if (error || typeof connectionId !== "string") return { status: "error", message: sendErrorMessage(error) };

  // Yoco signs every payment notification with a secret it gives us once, here.
  const res = await fetch("https://payments.yoco.com/api/webhooks", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Ledgerly ${ctx.workspace.slug}`, url: `${siteUrl()}/api/webhooks/yoco/${connectionId}` }),
  }).catch(() => null);
  const body = res ? ((await res.json().catch(() => ({}))) as { id?: string; secret?: string }) : {};
  if (!res?.ok || !body.secret) {
    await supabase.rpc("disconnect_payment_provider", { p_connection: connectionId });
    return {
      status: "error",
      message:
        res?.status === 401 || res?.status === 403
          ? "Yoco didn't accept that key. Copy the secret key again from the Yoco portal."
          : "Couldn't finish connecting to Yoco. Nothing was saved. Try again.",
    };
  }
  const { error: attachError } = await supabase.rpc("attach_yoco_webhook", {
    p_connection: connectionId,
    p_webhook_id: body.id ?? "",
    p_webhook_secret: body.secret,
  });
  if (attachError) {
    await supabase.rpc("disconnect_payment_provider", { p_connection: connectionId });
    return { status: "error", message: "Couldn't finish connecting to Yoco. Nothing was saved." };
  }
  revalidatePath(`/${slug}/settings/payments`);
  return { status: "saved", message: `Yoco connected (${mode === "live" ? "live" : "test"} mode). Your clients can now pay by card.` };
}

export async function connectPayfast(slug: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const parsed = payfastSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { status: "error", message: first(parsed) };
  const ctx = await managers(slug);
  if (!ctx) return { status: "error", message: "Only owners and admins can connect PayFast." };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("connect_payment_provider", {
    p_workspace: ctx.workspace.id,
    p_provider: "payfast",
    p_mode: parsed.data.mode,
    p_merchant_id: parsed.data.merchantId,
    p_secret: parsed.data.merchantKey,
    p_passphrase: parsed.data.passphrase || null,
  });
  if (error) return { status: "error", message: sendErrorMessage(error) };
  revalidatePath(`/${slug}/settings/payments`);
  return { status: "saved", message: `PayFast connected (${parsed.data.mode} mode).` };
}

export async function disconnectProvider(slug: string, connectionId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(connectionId).success) return { ok: false };
  const ctx = await managers(slug);
  if (!ctx) return { ok: false };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("disconnect_payment_provider", { p_connection: connectionId });
  revalidatePath(`/${slug}/settings/payments`);
  return { ok: !error };
}

/** EFT, cash or card-machine payment, with an optional proof file stored privately. */
export async function recordPayment(slug: string, documentId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  if (!z.uuid().safeParse(documentId).success) return { status: "error", message: "That invoice doesn't exist." };
  const parsed = manualPaymentSchema.safeParse({
    amount: form.get("amount"),
    method: form.get("method"),
    paidOn: form.get("paidOn"),
    reference: form.get("reference") ?? "",
    requestId: form.get("requestId"),
  });
  if (!parsed.success) return { status: "error", message: first(parsed) };
  const ctx = await requireWorkspace(slug);
  if (ctx.role === "accountant") return { status: "error", message: "Your role can't record payments." };
  const supabase = await createServerClient();

  let proofPath: string | null = null;
  const file = form.get("proof");
  if (file instanceof File && file.size > 0) {
    const ext = PROOF_TYPES[file.type];
    if (!ext) return { status: "error", message: "Proof of payment can be a photo (JPG, PNG) or a PDF." };
    if (file.size > MAX_PROOF_BYTES) return { status: "error", message: "That file is over 5 MB." };
    proofPath = `${ctx.workspace.id}/${documentId}/${randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("payment-proofs")
      .upload(proofPath, file, { contentType: file.type, upsert: false });
    if (upErr) return { status: "error", message: "Couldn't upload the proof of payment." };
  }

  const { data, error } = await supabase.rpc("record_manual_payment", {
    p_doc: documentId,
    p_amount_cents: parsed.data.amount,
    p_method: parsed.data.method,
    p_paid_on: parsed.data.paidOn,
    p_reference: parsed.data.reference || null,
    p_proof_path: proofPath,
    p_request: parsed.data.requestId,
  });
  if (error) return { status: "error", message: sendErrorMessage(error) };
  revalidatePath(`/${slug}/money/${documentId}`);
  revalidatePath(`/${slug}/money`);
  const result = data as { duplicate?: boolean; first?: boolean } | null;
  return {
    status: "saved",
    message: result?.duplicate ? "Already recorded." : "Payment recorded.",
    first: !!result?.first,
  };
}

/** A short-lived link to view one proof of payment (members only, via storage rules). */
export async function proofLink(slug: string, path: string): Promise<string | null> {
  const ctx = await requireWorkspace(slug);
  if (!path.startsWith(`${ctx.workspace.id}/`)) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 60);
  return data?.signedUrl ?? null;
}
