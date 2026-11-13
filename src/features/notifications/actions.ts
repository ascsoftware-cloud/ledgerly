"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
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
  // Re-subscribing the same device replaces its row (people cannot update subscriptions, only add and remove them).
  await supabase.from("push_subscriptions").delete().eq("endpoint", parsed.data.endpoint).eq("user_id", ctx.user.id);
  const { error } = await supabase
    .from("push_subscriptions")
    .insert({ user_id: ctx.user.id, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, user_agent: userAgent.slice(0, 300) });
  return { ok: !error };
}

export async function removePushSubscription(slug: string, endpoint: string): Promise<{ ok: boolean }> {
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return { ok: false };
  const ctx = await requireWorkspace(slug);
  const supabase = await createServerClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", ctx.user.id);
  return { ok: !error };
}
