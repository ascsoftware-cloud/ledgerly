"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { cancelPayfastSubscription, readBillingEnv } from "@/server/billing/payfast-subscription";
import { getToken, setCancelling } from "@/server/billing/service";

export type DeletionResult = { ok: true; on: string } | { ok: false; message: string };
export type PlainResult = { ok: true } | { ok: false; message: string };

const FRIENDLY = (e: { code?: string; message?: string }) => ((e.code === "LDG03" || e.code === "LDG01") && e.message ? e.message : "Couldn't do that. Please try again.");

/** Owner asks to delete the business. The typed name must match. Pro is cancelled at PayFast first so nobody is charged again. */
export async function requestWorkspaceDeletion(slug: string, typedName: unknown): Promise<DeletionResult> {
  const typed = z.string().trim().safeParse(typedName);
  const ctx = await requireWorkspace(slug);
  if (ctx.role !== "owner") return { ok: false, message: "Only the owner can delete a business." };
  if (!typed.success || typed.data.toLowerCase() !== ctx.workspace.name.trim().toLowerCase()) {
    return { ok: false, message: "Type the business name exactly as shown to confirm." };
  }
  const supabase = await createServerClient();
  const { data: sub } = await supabase.from("subscriptions").select("status").eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (sub?.status === "active") {
    const env = readBillingEnv();
    const token = await getToken(ctx.workspace.id, ctx.user.id);
    if (!env || !token) return { ok: false, message: "Cancel Pro first (More > Plan and billing), so you are not charged again." };
    const stopped = await cancelPayfastSubscription(token, env);
    if (!stopped.ok) return { ok: false, message: "We couldn't reach PayFast to stop your subscription. Please try again in a moment." };
    await setCancelling({ workspaceId: ctx.workspace.id });
  }
  const { data, error } = await supabase.rpc("request_workspace_deletion", { p_workspace: ctx.workspace.id });
  if (error) return { ok: false, message: FRIENDLY(error) };
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, on: typeof data === "string" ? data : "" };
}

export async function cancelWorkspaceDeletion(slug: string): Promise<PlainResult> {
  const ctx = await requireWorkspace(slug);
  if (ctx.role !== "owner") return { ok: false, message: "Only the owner can do that." };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("cancel_workspace_deletion", { p_workspace: ctx.workspace.id });
  if (error) return { ok: false, message: FRIENDLY(error) };
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

/** Anyone asks to delete their own account. The database refuses while other people are in a business they own. */
export async function requestAccountDeletion(slug: string, typed: unknown): Promise<DeletionResult> {
  await requireWorkspace(slug);
  if (typed !== "DELETE") return { ok: false, message: "Type DELETE (in capitals) to confirm." };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error) return { ok: false, message: FRIENDLY(error) };
  revalidatePath(`/${slug}`, "layout");
  return { ok: true, on: typeof data === "string" ? data : "" };
}

export async function cancelAccountDeletion(slug: string): Promise<PlainResult> {
  await requireWorkspace(slug);
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("cancel_account_deletion");
  if (error) return { ok: false, message: FRIENDLY(error) };
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}
