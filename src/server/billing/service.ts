import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The billing functions in the database are callable by the server only (migration 0038). Every caller has
 * already proved who it is: the signed-in owner (requireWorkspace) or a PayFast notification that passed all of
 * PayFast's checks. The database checks ownership and amounts again.
 */
const OUTCOME = z.enum(["activated", "extended", "extra_subscription", "duplicate", "unknown"]);

export async function startCheckout(workspaceId: string, userId: string, amountCents: number): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const { data, error } = await createAdminClient().rpc("billing_start_checkout", { p_workspace: workspaceId, p_user: userId, p_amount_cents: amountCents });
    if (error) return { ok: false, message: error.code === "LDG03" && error.message ? error.message : "Couldn't start the upgrade. Please try again." };
    const id = z.uuid().safeParse(data);
    return id.success ? { ok: true, id: id.data } : { ok: false, message: "Couldn't start the upgrade. Please try again." };
  } catch {
    return { ok: false, message: "Couldn't start the upgrade. Please try again." };
  }
}

export async function applyPayment(i: { checkoutId: string | null; token: string | null; pfPaymentId: string; amountCents: number }) {
  const { data, error } = await createAdminClient().rpc("billing_apply_payment", {
    p_checkout: i.checkoutId,
    p_token: i.token,
    p_pf_payment_id: i.pfPaymentId,
    p_amount_cents: i.amountCents,
  });
  if (error) throw new Error(`billing_apply_payment failed: ${error.code}`);
  return OUTCOME.parse(data);
}

export async function setCancelling(i: { workspaceId?: string; token?: string }): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("billing_set_cancelling", { p_workspace: i.workspaceId ?? null, p_token: i.token ?? null });
  if (error) throw new Error(`billing_set_cancelling failed: ${error.code}`);
  return data === true;
}

export async function getToken(workspaceId: string, userId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("billing_get_token", { p_workspace: workspaceId, p_user: userId });
  if (error) return null;
  return typeof data === "string" && data ? data : null;
}
