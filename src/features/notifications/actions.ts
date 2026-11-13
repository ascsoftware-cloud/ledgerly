"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { recordConsent } from "@/features/privacy/consent";
import { requireWorkspace } from "@/lib/workspace";
import { prefsSchema, pushSubscriptionSchema, type PushSubscriptionInput } from "./schema";

export async function markRead(slug: string, id: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(id).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  const supabase = await createServerClient();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.user.id).is("read_at", null);
  revalidatePath(`/${slug}/notifications`);
  return { ok: !error };
}

export async function markAllRead(slug: string): Promise<{ ok: boolean }> {
  const ctx = await requireWorkspace(slug);
  const supabase = await createServerClient();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("workspace_id", ctx.workspace.id).eq("user_id", ctx.user.id).is("read_at", null);
  revalidatePath(`/${slug}/notifications`);
  return { ok: !error };
}

export async function setPref(slug: string, kind: string, enabled: boolean, push: boolean): Promise<{ ok: boolean }> {
  const parsed = prefsSchema.safeParse({ kind, enabled, push });
  if (!parsed.success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  const supabase = await createServerClient();
  const { error } = await supabase.from("notification_prefs").upsert({ user_id: ctx.user.id, ...parsed.data }, { onConflict: "user_id,kind" });
  revalidatePath(`/${slug}/settings/notifications`);
  return { ok: !error };
}

/** Saves this device for web push. The endpoint must be https; the database checks the owner. */
export async function savePushSubscription(slug: string, sub: PushSubscriptionInput, userAgent: string): Promise<{ ok: boolean }> {
  const parsed = pushSubscriptionSchema.safeParse(sub);
  if (!parsed.success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  const supabase = await createServerClient();
  // A device belongs to whoever subscribes on it: the database moves the row if someone else had it.
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: userAgent.slice(0, 300),
  });
  if (!error) await recordConsent(supabase, { userId: ctx.user.id, workspaceId: null, kind: "push", granted: true });
  return { ok: !error };
}

export async function removePushSubscription(slug: string, endpoint: string): Promise<{ ok: boolean }> {
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return { ok: false };
  const ctx = await requireWorkspace(slug);
  const supabase = await createServerClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", ctx.user.id);
  if (!error) await recordConsent(supabase, { userId: ctx.user.id, workspaceId: null, kind: "push", granted: false });
  return { ok: !error };
}

/** Called at sign-out, before the session ends: this device stops receiving the signed-out person's alerts. */
export async function removeDevicePush(endpoint: string): Promise<{ ok: boolean }> {
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return { ok: false };
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", uid);
  return { ok: !error };
}
