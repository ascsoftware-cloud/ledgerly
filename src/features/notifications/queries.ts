import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import { KINDS, type Kind } from "./schema";

const row = z.object({
  id: z.uuid(),
  kind: z.enum(KINDS),
  title: z.string(),
  href: z.string().nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
});
export type NotificationRow = z.infer<typeof row>;

/** The signed-in person's own notifications for this business, newest first. */
export async function listNotifications(ctx: WorkspaceContext, limit = 50): Promise<NotificationRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, kind, title, href, read_at, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return z.array(row).catch([]).parse(data ?? []);
}

export async function unreadCount(ctx: WorkspaceContext): Promise<number> {
  const supabase = await createServerClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", ctx.user.id)
    .is("read_at", null);
  return count ?? 0;
}

export type Prefs = Record<Kind, { enabled: boolean; push: boolean }>;

/** Every kind, with the person's choice or the default (on). */
export async function getPrefs(ctx: WorkspaceContext): Promise<Prefs> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("notification_prefs").select("kind, enabled, push").eq("user_id", ctx.user.id);
  const saved = new Map((data ?? []).map((p) => [p.kind as string, p]));
  return Object.fromEntries(KINDS.map((k) => [k, { enabled: saved.get(k)?.enabled ?? true, push: saved.get(k)?.push ?? true }])) as Prefs;
}
