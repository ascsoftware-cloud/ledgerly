"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { siteUrl } from "@/lib/site-url";
import { todaySAST } from "@/lib/dates";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace, type WorkspaceContext } from "@/lib/workspace";
import { runOutbox } from "@/server/jobs/run-outbox";
import { businessName, getContactForContract, getTemplate } from "./queries";
import { builtinData, contractSchema, customFields, FILE_TYPES, fileSchema, folderSchema, isAllowedFile, renderTemplate, templateSchema } from "./schema";

export type FormResult = { status: "idle" } | { status: "saved"; id: string; message: string } | { status: "error"; message: string };

const NO_WRITE = "Your role can view documents but not change them.";
const canWrite = (ctx: WorkspaceContext) => ctx.role !== "accountant";
const refresh = (slug: string) => revalidatePath(`/${slug}/docs`, "layout");
const ruleMessage = (e: { code?: string; message?: string } | null, fallback: string) =>
  e && ["LDG02", "LDG03"].includes(e.code ?? "") && e.message ? e.message : fallback;
const portalUrl = (token: string) => `${siteUrl()}/portal/${token}`;

// ---------------------------------------------------------------------------
// Folders and files
// ---------------------------------------------------------------------------
export async function createFolder(slug: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const parsed = folderSchema.safeParse({ name: form.get("name") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the name." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { status: "error", message: NO_WRITE };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("folders").insert({ workspace_id: ctx.workspace.id, name: parsed.data.name }).select("id").single();
  if (error || !data) return { status: "error", message: error?.code === "23505" ? "You already have a folder with that name." : "Couldn't make the folder." };
  refresh(slug);
  return { status: "saved", id: data.id as string, message: `Folder “${parsed.data.name}” added.` };
}

export async function archiveFolder(slug: string, folderId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(folderId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false };
  const supabase = await createServerClient();
  // Its files go back to "No folder" (a soft-deleted folder would otherwise keep them out of sight).
  await supabase.from("files").update({ folder_id: null }).eq("folder_id", folderId).eq("workspace_id", ctx.workspace.id);
  const { data } = await supabase.from("folders").update({ deleted_at: new Date().toISOString() }).eq("id", folderId).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
  refresh(slug);
  return { ok: !!data };
}

/**
 * Records a file the browser already uploaded straight to the private bucket (a Server Action body is capped
 * well under 10 MB). The object must exist under this workspace's folder, so a made-up path records nothing.
 */
export async function recordFile(slug: string, input: { path: string; name: string; type: string; size: number; folderId: string | null }): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false, message: NO_WRITE };
  if (!isAllowedFile({ name: input.name, type: input.type, size: input.size })) return { ok: false, message: "That kind of file isn't allowed, or it is over 10 MB." };
  const ext = FILE_TYPES[input.type];
  const shape = new RegExp(`^${ctx.workspace.id}/[0-9a-f-]{36}/[0-9a-f-]{36}[.]${ext}$`);
  if (!shape.test(input.path)) return { ok: false, message: "The upload didn't work. Try again." };
  if (input.folderId !== null && !z.uuid().safeParse(input.folderId).success) return { ok: false, message: "Choose a folder from the list." };
  const supabase = await createServerClient();
  const { error: missing } = await supabase.storage.from("documents").createSignedUrl(input.path, 5);
  if (missing) return { ok: false, message: "The upload didn't work. Try again." };
  const { error } = await supabase.from("files").insert({
    workspace_id: ctx.workspace.id,
    folder_id: input.folderId,
    name: fileSchema.parse({ name: input.name }).name,
    storage_path: input.path,
    mime_type: input.type,
    size_bytes: input.size,
  });
  if (error) return { ok: false, message: error.code === "23503" ? "Choose a folder from the list." : "Couldn't save the file." };
  refresh(slug);
  return { ok: true };
}

/** A 60-second link to open one file. The storage rules check membership again. */
export async function fileLink(slug: string, fileId: string): Promise<string | null> {
  if (!z.uuid().safeParse(fileId).success) return null;
  const ctx = await requireWorkspace(slug);
  const supabase = await createServerClient();
  const { data: row } = await supabase.from("files").select("storage_path").eq("id", fileId).eq("workspace_id", ctx.workspace.id).is("deleted_at", null).maybeSingle();
  if (!row?.storage_path) return null;
  const { data } = await supabase.storage.from("documents").createSignedUrl(row.storage_path as string, 60);
  return data?.signedUrl ?? null;
}

export async function archiveFile(slug: string, fileId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(fileId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("files").update({ deleted_at: new Date().toISOString() }).eq("id", fileId).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
  refresh(slug);
  return { ok: !!data };
}

// ---------------------------------------------------------------------------
// Templates and contracts
// ---------------------------------------------------------------------------
export async function saveTemplate(slug: string, templateId: string | null, _prev: FormResult, form: FormData): Promise<FormResult> {
  if (templateId !== null && !z.uuid().safeParse(templateId).success) return { status: "error", message: "That template doesn't exist." };
  const parsed = templateSchema.safeParse({ name: form.get("name") ?? "", body: form.get("body") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { status: "error", message: NO_WRITE };
  const supabase = await createServerClient();
  let id = templateId;
  if (id === null) {
    const { data, error } = await supabase.from("contract_templates").insert({ workspace_id: ctx.workspace.id, ...parsed.data }).select("id").single();
    if (error || !data) return { status: "error", message: "Couldn't save the template." };
    id = data.id as string;
  } else {
    const { data, error } = await supabase.from("contract_templates").update(parsed.data).eq("id", id).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
    if (error || !data) return { status: "error", message: "Couldn't save the template." };
  }
  refresh(slug);
  return { status: "saved", id, message: templateId ? "Template updated." : "Template saved." };
}

export async function archiveTemplate(slug: string, templateId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(templateId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("contract_templates").update({ deleted_at: new Date().toISOString() }).eq("id", templateId).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
  refresh(slug);
  return { ok: !!data };
}

/**
 * Makes a draft contract for one client: the template (or the text typed) with the client, business and any
 * extra fields filled in, stored as plain text. Every field must be filled, so nothing goes out with a gap.
 */
export async function createContract(slug: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { status: "error", message: NO_WRITE };
  const contact = await getContactForContract(ctx, String(form.get("contactId") ?? ""));
  if (!contact) return { status: "error", message: "Choose a client." };

  const templateId = String(form.get("templateId") ?? "");
  let source = String(form.get("body") ?? "");
  if (templateId) {
    const t = await getTemplate(ctx, templateId);
    if (!t) return { status: "error", message: "That template doesn't exist." };
    source = t.body;
  }
  if (!source.trim()) return { status: "error", message: "Choose a template or write the contract." };

  const data: Record<string, string> = { ...builtinData({ client: { name: contact.name, email: contact.email, phone: contact.phone, company: contact.companies?.name ?? null }, businessName: await businessName(ctx), today: todaySAST() }) };
  for (const f of customFields(source)) {
    const v = String(form.get(`f_${f}`) ?? "").trim();
    if (!v) return { status: "error", message: `Fill in “${f.replace(/_/g, " ")}”.` };
    if (v.length > 500) return { status: "error", message: `Keep “${f.replace(/_/g, " ")}” under 500 characters.` };
    data[f] = v;
  }
  const parsed = contractSchema.safeParse({ contactId: contact.id, templateId: templateId || null, title: form.get("title") ?? "", body: renderTemplate(source, data, "text") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  const supabase = await createServerClient();
  const { data: row, error } = await supabase
    .from("contracts")
    .insert({ workspace_id: ctx.workspace.id, contact_id: parsed.data.contactId, template_id: parsed.data.templateId ?? null, title: parsed.data.title, body: parsed.data.body })
    .select("id")
    .single();
  if (error || !row) return { status: "error", message: "Couldn't make the contract." };
  refresh(slug);
  return { status: "saved", id: row.id as string, message: "Contract drafted. Read it through, then send it for signing." };
}

export async function saveContract(slug: string, contractId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  if (!z.uuid().safeParse(contractId).success) return { status: "error", message: "That contract doesn't exist." };
  const parsed = z.object({ title: contractSchema.shape.title, body: contractSchema.shape.body }).safeParse({ title: form.get("title") ?? "", body: form.get("body") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { status: "error", message: NO_WRITE };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("contracts").update(parsed.data).eq("id", contractId).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
  if (error) return { status: "error", message: ruleMessage(error, "Couldn't save the contract.") };
  if (!data) return { status: "error", message: "Couldn't save the contract." };
  refresh(slug);
  return { status: "saved", id: contractId, message: "Saved." };
}

/** Freezes the contract and returns the client's portal link to share. */
export async function sendContract(slug: string, contractId: string): Promise<{ ok: true; link: string } | { ok: false; message: string }> {
  if (!z.uuid().safeParse(contractId).success) return { ok: false, message: "That contract doesn't exist." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false, message: NO_WRITE };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("send_contract", { p_id: contractId });
  const token = (data as { portal_token?: unknown } | null)?.portal_token;
  if (error || typeof token !== "string") return { ok: false, message: ruleMessage(error, "Couldn't send the contract.") };
  refresh(slug);
  return { ok: true, link: portalUrl(token) };
}

export async function voidContract(slug: string, contractId: string): Promise<{ ok: boolean; message?: string }> {
  if (!z.uuid().safeParse(contractId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (ctx.role !== "owner" && ctx.role !== "admin") return { ok: false, message: "Only owners and admins can withdraw a contract." };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("void_contract", { p_id: contractId });
  refresh(slug);
  return error ? { ok: false, message: ruleMessage(error, "Couldn't withdraw the contract.") } : { ok: true };
}

export async function deleteContractDraft(slug: string, contractId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(contractId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("contracts").delete().eq("id", contractId).eq("workspace_id", ctx.workspace.id).eq("status", "draft").select("id");
  refresh(slug);
  return { ok: !!data?.length };
}

// ---------------------------------------------------------------------------
// The client's portal link
// ---------------------------------------------------------------------------
export type LinkResult = { ok: true; link: string | null } | { ok: false; message: string };

async function portalAction(slug: string, contactId: string, fn: "create_portal_link" | "rotate_portal_link" | "revoke_portal_link"): Promise<LinkResult> {
  if (!z.uuid().safeParse(contactId).success) return { ok: false, message: "That client doesn't exist." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false, message: NO_WRITE };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc(fn, { p_contact: contactId });
  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  revalidatePath(`/${slug}/clients/${contactId}`);
  return { ok: true, link: typeof data === "string" ? portalUrl(data) : null };
}
export async function createPortalLink(slug: string, contactId: string): Promise<LinkResult> {
  return portalAction(slug, contactId, "create_portal_link");
}
export async function rotatePortalLink(slug: string, contactId: string): Promise<LinkResult> {
  return portalAction(slug, contactId, "rotate_portal_link");
}
export async function revokePortalLink(slug: string, contactId: string): Promise<LinkResult> {
  return portalAction(slug, contactId, "revoke_portal_link");
}

export async function emailPortalLink(slug: string, contactId: string, message: string, requestId: string): Promise<{ ok: boolean; message?: string }> {
  if (!z.uuid().safeParse(contactId).success || !z.uuid().safeParse(requestId).success) return { ok: false, message: "Refresh the page and try again." };
  if (message.length > 1000) return { ok: false, message: "Keep the message under 1 000 characters." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false, message: NO_WRITE };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("queue_portal_email", { p_contact: contactId, p_message: message.trim() || null, p_request: requestId });
  if (error) return { ok: false, message: ruleMessage(error, "Couldn't queue the email.") };
  after(() => runOutbox().catch(() => undefined));
  revalidatePath(`/${slug}/clients/${contactId}`);
  return { ok: true };
}
