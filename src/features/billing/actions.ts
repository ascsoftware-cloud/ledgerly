"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PLANS } from "@/lib/plans";
import { todaySAST } from "@/lib/dates";
import { siteUrl } from "@/lib/site-url";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { buildSubscriptionForm, cancelPayfastSubscription, readBillingEnv } from "@/server/billing/payfast-subscription";
import { getToken, setCancelling, startCheckout } from "@/server/billing/service";

export type UpgradeResult = { ok: true; action: string; fields: [string, string][] } | { ok: false; message: string };

/** Starts a Pro subscription. Only the owner; the browser then posts the signed form to PayFast's hosted page. */
export async function startUpgrade(slug: string): Promise<UpgradeResult> {
  const ctx = await requireWorkspace(slug);
  if (ctx.role !== "owner") return { ok: false, message: "Only the owner can change the plan." };
  if (ctx.workspace.plan === "pro") return { ok: false, message: "This business is already on Pro." };
  const env = readBillingEnv();
  if (!env) return { ok: false, message: "Paying for Pro isn't switched on yet. Please check back soon." };
  const checkout = await startCheckout(ctx.workspace.id, ctx.user.id, PLANS.pro.priceCents);
  if (!checkout.ok) return checkout;
  const back = `${siteUrl()}/${ctx.workspace.slug}/settings/plan`;
  const form = buildSubscriptionForm({
    env,
    checkoutId: checkout.id,
    amountCents: PLANS.pro.priceCents,
    email: ctx.user.email,
    nameFirst: ctx.user.firstName ?? "",
    itemName: `Ledgerly Pro: ${ctx.workspace.name}`.slice(0, 100),
    returnUrl: `${back}?paid=1`,
    cancelUrl: back,
    notifyUrl: `${siteUrl()}/api/webhooks/payfast-billing`,
    billingDate: todaySAST(),
  });
  return { ok: true, ...form };
}

export type CancelResult = { ok: true } | { ok: false; message: string };

/** Stops the subscription at PayFast, then ends Pro when the paid month runs out. Nothing is hidden or deleted. */
export async function cancelPlan(slug: string): Promise<CancelResult> {
  const ctx = await requireWorkspace(slug);
  if (ctx.role !== "owner") return { ok: false, message: "Only the owner can change the plan." };
  const env = readBillingEnv();
  const token = await getToken(ctx.workspace.id, ctx.user.id);
  if (!env || !token) return { ok: false, message: "We couldn't find a subscription to cancel. If you are still being charged, cancel it in your PayFast account." };
  const stopped = await cancelPayfastSubscription(token, env);
  if (!stopped.ok) return { ok: false, message: "We couldn't reach PayFast to cancel. Please try again, or cancel it in your PayFast account." };
  await setCancelling({ workspaceId: ctx.workspace.id });
  revalidatePath(`/${slug}/settings/plan`);
  return { ok: true };
}

export type AddBusinessResult = { ok: true; slug: string } | { ok: false; message: string };

/** A Pro owner adds another business (it starts on Free). The database checks Pro and the limit. */
export async function addBusiness(slug: string, name: unknown): Promise<AddBusinessResult> {
  const parsed = z.string().trim().min(1, "Give the business a name.").max(60, "Keep the name under 60 characters.").safeParse(name);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give the business a name." };
  await requireWorkspace(slug);
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_additional_workspace", { p_name: parsed.data });
  if (error) return { ok: false, message: (error.code === "LDG01" || error.code === "LDG03") && error.message ? error.message : "Couldn't add the business. Please try again." };
  const made = z.object({ slug: z.string() }).safeParse(data);
  return made.success ? { ok: true, slug: made.data.slug } : { ok: false, message: "Couldn't add the business. Please try again." };
}
