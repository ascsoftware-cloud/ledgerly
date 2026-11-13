import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { requestIp } from "@/features/sales/public-data";
import { rateLimit } from "@/lib/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import { hashToken } from "./schema";

const memberRow = z
  .object({
    member_id: z.uuid(),
    member_role: z.enum(["owner", "admin", "staff", "accountant"]),
    member_name: z.string().nullable(),
    member_email: z.string(),
    joined_at: z.string(),
  })
  .transform((m) => ({ userId: m.member_id, role: m.member_role, name: m.member_name, email: m.member_email, joinedAt: m.joined_at }));
export type Member = z.output<typeof memberRow>;

/** The team with their emails. The database only answers owners and admins. */
export async function listMembers(ctx: WorkspaceContext): Promise<Member[]> {
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("list_members", { p_workspace: ctx.workspace.id });
  return z.array(memberRow).catch([]).parse(data ?? []);
}

const inviteRow = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(["admin", "staff", "accountant"]),
  expires_at: z.string(),
  created_at: z.string(),
});
export type PendingInvite = z.infer<typeof inviteRow>;

export async function listInvites(ctx: WorkspaceContext): Promise<PendingInvite[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("invites")
    .select("id, email, role, expires_at, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  return z.array(inviteRow).catch([]).parse(data ?? []);
}

const auditRow = z.object({
  id: z.uuid(),
  action: z.string(),
  summary: z.string(),
  created_at: z.string(),
  actor_id: z.uuid().nullable(),
});
export type AuditEntry = z.infer<typeof auditRow>;

export async function listAudit(ctx: WorkspaceContext, limit = 100): Promise<AuditEntry[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("audit_log")
    .select("id, action, summary, created_at, actor_id")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return z.array(auditRow).catch([]).parse(data ?? []);
}

const previewSchema = z.object({
  business: z.string(),
  role: z.enum(["admin", "staff", "accountant"]),
  email_hint: z.string(),
  state: z.enum(["open", "accepted", "expired"]),
});
export type InvitePreview = z.infer<typeof previewSchema>;

/** What the invitation page may show before sign-in. At most 60 looks an hour per visitor. */
export async function loadInvitePreview(token: string): Promise<{ kind: "ok"; preview: InvitePreview } | { kind: "missing" } | { kind: "busy" }> {
  await connection();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { kind: "missing" };
  if (!(await rateLimit("invite-ip", await requestIp(), 60, 3600))) return { kind: "busy" };
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("invite_preview", { p_token_hash: hashToken(token) });
  const parsed = previewSchema.safeParse(data);
  return parsed.success ? { kind: "ok", preview: parsed.data } : { kind: "missing" };
}
