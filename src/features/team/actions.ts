"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace, type WorkspaceContext } from "@/lib/workspace";
import { runOutbox } from "@/server/jobs/run-outbox";
import { hashToken, inviteSchema, newToken, roleSchema } from "./schema";

export type FormResult = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

const isAdmin = (ctx: WorkspaceContext) => ctx.role === "owner" || ctx.role === "admin";
/** Messages written in the database for the person (rule codes, ownership guards). */
const dbMessage = (e: { code?: string; message?: string } | null, fallback: string) =>
  e && ["LDG03", "23514", "42501"].includes(e.code ?? "") && e.message ? e.message : fallback;

async function sendInvite(ctx: WorkspaceContext, email: string, role: "admin" | "staff" | "accountant", request: string) {
  const supabase = await createServerClient();
  const token = newToken();
  const { data: inviteId, error } = await supabase.rpc("invite_member", {
    p_workspace: ctx.workspace.id,
    p_email: email,
    p_role: role,
    p_token_hash: hashToken(token),
    // The same button press again must not rotate the token a second time (its email is already queued).
    p_request: request,
  });
  if (error || typeof inviteId !== "string") return { ok: false as const, message: dbMessage(error, "Couldn't create the invitation.") };
  const { error: qErr } = await supabase.rpc("queue_invite_email", { p_invite: inviteId, p_token: token, p_request: request });
  if (qErr) return { ok: false as const, message: dbMessage(qErr, "The invitation was saved but the email couldn't be queued. Try again.") };
  after(() => runOutbox().catch(() => undefined));
  return { ok: true as const };
}

export async function inviteMember(slug: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const parsed = inviteSchema.safeParse({ email: form.get("email") ?? "", role: form.get("role") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const request = form.get("requestId");
  if (typeof request !== "string" || !z.uuid().safeParse(request).success) return { status: "error", message: "Refresh the page and try again." };
  const ctx = await requireWorkspace(slug);
  if (!isAdmin(ctx)) return { status: "error", message: "Only owners and admins can invite people." };
  if (!(await rateLimit("app-connect", `invite:${ctx.workspace.id}`, 30, 3600))) {
    return { status: "error", message: "That's a lot of invitations. Try again in a little while." };
  }
  const r = await sendInvite(ctx, parsed.data.email, parsed.data.role, request);
  if (!r.ok) return { status: "error", message: r.message };
  revalidatePath(`/${slug}/settings/team`);
  return { status: "saved", message: `Invitation sent to ${parsed.data.email}.` };
}

/** A new link for someone who has not accepted yet (the old link stops working). */
export async function resendInvite(slug: string, email: string, role: string): Promise<{ ok: boolean; message?: string }> {
  const parsed = inviteSchema.safeParse({ email, role });
  if (!parsed.success) return { ok: false, message: "That invitation can't be sent again." };
  const ctx = await requireWorkspace(slug);
  if (!isAdmin(ctx)) return { ok: false, message: "Only owners and admins can invite people." };
  if (!(await rateLimit("app-connect", `invite:${ctx.workspace.id}`, 30, 3600))) return { ok: false, message: "Try again in a little while." };
  const r = await sendInvite(ctx, parsed.data.email, parsed.data.role, crypto.randomUUID());
  revalidatePath(`/${slug}/settings/team`);
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}

export async function cancelInvite(slug: string, inviteId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(inviteId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!isAdmin(ctx)) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("invites").delete().eq("id", inviteId).eq("workspace_id", ctx.workspace.id).select("id");
  revalidatePath(`/${slug}/settings/team`);
  return { ok: !!data?.length };
}

export async function changeRole(slug: string, userId: string, role: string): Promise<{ ok: boolean; message?: string }> {
  const r = roleSchema.safeParse(role);
  if (!r.success || !z.uuid().safeParse(userId).success) return { ok: false, message: "Choose a role." };
  const ctx = await requireWorkspace(slug);
  if (!isAdmin(ctx)) return { ok: false, message: "Only owners and admins can change roles." };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .update({ role: r.data })
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", userId)
    .select("user_id");
  revalidatePath(`/${slug}/settings/team`);
  if (error) return { ok: false, message: dbMessage(error, "Couldn't change that role.") };
  return data?.length ? { ok: true } : { ok: false, message: "You can't change that person's role." };
}

export async function removeMember(slug: string, userId: string): Promise<{ ok: boolean; message?: string }> {
  if (!z.uuid().safeParse(userId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!isAdmin(ctx)) return { ok: false, message: "Only owners and admins can remove people." };
  if (userId === ctx.user.id) return { ok: false, message: "Use “Leave this business” to remove yourself." };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("memberships").delete().eq("workspace_id", ctx.workspace.id).eq("user_id", userId).select("user_id");
  revalidatePath(`/${slug}/settings/team`);
  if (error) return { ok: false, message: dbMessage(error, "Couldn't remove that person.") };
  return data?.length ? { ok: true } : { ok: false, message: "You can't remove that person." };
}

export async function leaveWorkspace(slug: string): Promise<{ ok: false; message: string }> {
  const ctx = await requireWorkspace(slug);
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("memberships").delete().eq("workspace_id", ctx.workspace.id).eq("user_id", ctx.user.id).select("user_id");
  if (error || !data?.length) return { ok: false, message: dbMessage(error, "Couldn't leave. Try again.") };
  redirect("/");
}

export type AcceptResult = { status: "error"; message: string };

/** Joins the business the invitation was sent for. The database checks the signed-in email matches. */
export async function acceptInvite(token: string): Promise<AcceptResult> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: "error", message: "This invitation link is not valid." };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("accept_invite", { p_token_hash: hashToken(token) });
  const slug = (data as { slug?: unknown } | null)?.slug;
  if (error || typeof slug !== "string") return { status: "error", message: dbMessage(error, "Couldn't accept the invitation. Try again.") };
  redirect(`/${slug}`);
}
