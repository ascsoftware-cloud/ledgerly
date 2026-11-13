import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

const folderRow = z.object({ id: z.uuid(), name: z.string() });
export type FolderRow = z.infer<typeof folderRow>;

export async function listFolders(ctx: WorkspaceContext): Promise<FolderRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("folders").select("id, name").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).order("name").limit(200);
  return z.array(folderRow).catch([]).parse(data ?? []);
}

const fileRow = z.object({
  id: z.uuid(),
  name: z.string(),
  mime_type: z.string(),
  size_bytes: z.coerce.number(),
  folder_id: z.uuid().nullable(),
  created_at: z.string(),
});
export type FileRow = z.infer<typeof fileRow>;

/** Files in one folder, in no folder ("none"), or all of them. */
export async function listFiles(ctx: WorkspaceContext, folder: string | "none" | null): Promise<FileRow[]> {
  const supabase = await createServerClient();
  let q = supabase.from("files").select("id, name, mime_type, size_bytes, folder_id, created_at").eq("workspace_id", ctx.workspace.id).is("deleted_at", null);
  if (folder === "none") q = q.is("folder_id", null);
  else if (folder && z.uuid().safeParse(folder).success) q = q.eq("folder_id", folder);
  const { data } = await q.order("created_at", { ascending: false }).limit(300);
  return z.array(fileRow).catch([]).parse(data ?? []);
}

const templateRow = z.object({ id: z.uuid(), name: z.string(), body: z.string() });
export type TemplateRow = z.infer<typeof templateRow>;

export async function listTemplates(ctx: WorkspaceContext): Promise<TemplateRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("contract_templates").select("id, name, body").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).order("name").limit(200);
  return z.array(templateRow).catch([]).parse(data ?? []);
}

export async function getTemplate(ctx: WorkspaceContext, id: string): Promise<TemplateRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.from("contract_templates").select("id, name, body").eq("workspace_id", ctx.workspace.id).eq("id", id).is("deleted_at", null).maybeSingle();
  const p = templateRow.safeParse(data);
  return p.success ? p.data : null;
}

const contractRow = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  status: z.enum(["draft", "sent", "signed", "void"]),
  contact_id: z.uuid(),
  sent_at: z.string().nullable(),
  signed_at: z.string().nullable(),
  created_at: z.string(),
  contacts: z.object({ name: z.string() }).nullable(),
  contract_signatures: z.array(z.object({ signer_name: z.string(), signed_at: z.string(), ip_address: z.string().nullable(), user_agent: z.string().nullable(), document_hash: z.string(), signature_image: z.string().nullable() })),
});
export type ContractRow = z.infer<typeof contractRow>;

const CONTRACT_SELECT =
  "id, title, body, status, contact_id, sent_at, signed_at, created_at, contacts(name), contract_signatures(signer_name, signed_at, ip_address, user_agent, document_hash, signature_image)";

export async function listContracts(ctx: WorkspaceContext): Promise<ContractRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("contracts").select(CONTRACT_SELECT).eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(200);
  return z.array(contractRow).catch([]).parse(data ?? []);
}

export async function getContract(ctx: WorkspaceContext, id: string): Promise<ContractRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.from("contracts").select(CONTRACT_SELECT).eq("workspace_id", ctx.workspace.id).eq("id", id).maybeSingle();
  const p = contractRow.safeParse(data);
  return p.success ? p.data : null;
}

/** The client's active portal token. Only people who can share it (not the read-only accountant) can read it. */
export async function getPortalToken(ctx: WorkspaceContext, contactId: string): Promise<string | null> {
  if (!z.uuid().safeParse(contactId).success) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.from("portal_links").select("token").eq("workspace_id", ctx.workspace.id).eq("contact_id", contactId).is("revoked_at", null).maybeSingle();
  return typeof data?.token === "string" ? data.token : null;
}

const contactRow = z.object({ id: z.uuid(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), companies: z.object({ name: z.string() }).nullable() });

/** What a contract is filled from. */
export async function getContactForContract(ctx: WorkspaceContext, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.from("contacts").select("id, name, email, phone, companies(name)").eq("workspace_id", ctx.workspace.id).eq("id", id).is("deleted_at", null).maybeSingle();
  const p = contactRow.safeParse(data);
  return p.success ? p.data : null;
}

export async function businessName(ctx: WorkspaceContext): Promise<string> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("workspace_settings").select("business_name").eq("workspace_id", ctx.workspace.id).maybeSingle();
  return (data?.business_name as string | null)?.trim() || ctx.workspace.name;
}
