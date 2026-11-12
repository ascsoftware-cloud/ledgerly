"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { contactInputSchema, importRowSchema, MAX_IMPORT_ROWS, type ContactInput } from "./schema";

export type FormState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      fieldErrors?: Partial<Record<keyof ContactInput, string>>;
      /** What was typed, so the form can show it again (React clears fields after a submit). */
      values?: Record<keyof ContactInput, string>;
    };

const CAN_WRITE = ["owner", "admin", "staff"] as const;

async function writableWorkspace(slug: string) {
  const ctx = await requireWorkspace(slug);
  if (!(CAN_WRITE as readonly string[]).includes(ctx.role)) {
    throw new Error("Your role can view clients but not change them.");
  }
  return ctx;
}

function formValues(form: FormData) {
  const get = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  return { name: get("name"), email: get("email"), phone: get("phone"), company: get("company"), address: get("address") };
}

function fieldErrors(error: z.ZodError, values: Record<keyof ContactInput, string>): FormState {
  const errs: Partial<Record<keyof ContactInput, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof ContactInput;
    errs[key] ??= issue.message;
  }
  return { status: "error", message: "Check the highlighted fields.", fieldErrors: errs, values };
}

/** Finds a company by name (any case) in this workspace, creating it if new. */
async function companyId(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  workspaceId: string,
  name: string | null,
): Promise<string | null> {
  if (!name) return null;
  const { data: found } = await supabase
    .from("companies")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .ilike("name", name.replace(/[%_\\]/g, "\\$&"))
    .limit(1)
    .maybeSingle();
  if (found?.id) return found.id as string;
  const { data: created, error } = await supabase
    .from("companies")
    .insert({ workspace_id: workspaceId, name })
    .select("id")
    .single();
  if (error) throw new Error("Couldn't save the company.");
  return created.id as string;
}

export async function saveContact(slug: string, contactId: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const typed = formValues(form);
  const parsed = contactInputSchema.safeParse(typed);
  if (!parsed.success) return fieldErrors(parsed.error, typed);

  let ctx;
  try {
    ctx = await writableWorkspace(slug);
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }
  const supabase = await createServerClient();
  const input = parsed.data;

  let id = contactId;
  try {
    const company_id = await companyId(supabase, ctx.workspace.id, input.company);
    const values = { name: input.name, email: input.email, phone: input.phone, address: input.address, company_id };
    if (contactId) {
      if (!z.uuid().safeParse(contactId).success) return { status: "error", message: "That client doesn't exist." };
      const { error, count } = await supabase
        .from("contacts")
        .update(values, { count: "exact" })
        .eq("workspace_id", ctx.workspace.id)
        .eq("id", contactId);
      if (error || count === 0) return { status: "error", message: "Couldn't save. The client may have been removed." };
    } else {
      const { data, error } = await supabase
        .from("contacts")
        .insert({ workspace_id: ctx.workspace.id, ...values })
        .select("id")
        .single();
      if (error) return { status: "error", message: "Couldn't add the client. Try again." };
      id = data.id as string;
    }
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }

  revalidatePath(`/${slug}/clients`);
  redirect(`/${slug}/clients/${id}?saved=1`);
}

export async function setArchived(slug: string, contactId: string, archived: boolean): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(contactId).success) return { ok: false };
  const ctx = await writableWorkspace(slug).catch(() => null);
  if (!ctx) return { ok: false };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from("contacts")
    .update({ deleted_at: archived ? new Date().toISOString() : null }, { count: "exact" })
    .eq("workspace_id", ctx.workspace.id)
    .eq("id", contactId);
  revalidatePath(`/${slug}/clients`);
  return { ok: !error && count === 1 };
}

const noteSchema = z.string().trim().min(1, "Write something first.").max(5000, "Keep notes under 5 000 characters.");

export async function addNote(
  slug: string,
  contactId: string,
  _prev: { status: "idle" | "error" | "saved"; message?: string },
  form: FormData,
): Promise<{ status: "idle" | "error" | "saved"; message?: string }> {
  const body = noteSchema.safeParse(form.get("body"));
  if (!body.success) return { status: "error", message: body.error.issues[0]?.message };
  if (!z.uuid().safeParse(contactId).success) return { status: "error", message: "That client doesn't exist." };
  const ctx = await writableWorkspace(slug).catch(() => null);
  if (!ctx) return { status: "error", message: "Your role can't add notes." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("notes")
    .insert({ workspace_id: ctx.workspace.id, contact_id: contactId, body: body.data });
  if (error) return { status: "error", message: "Couldn't save the note." };
  revalidatePath(`/${slug}/clients/${contactId}`);
  return { status: "saved" };
}

export type ImportResult =
  | { ok: true; added: number }
  | { ok: false; message: string; rowErrors?: { row: number; message: string }[] };

/** Validates every row first; imports nothing if any row is wrong, so a file is never half-loaded. */
export async function importContacts(slug: string, rows: unknown): Promise<ImportResult> {
  const list = z.array(z.record(z.string(), z.string().nullable())).max(MAX_IMPORT_ROWS).safeParse(rows);
  if (!list.success) return { ok: false, message: `Import up to ${MAX_IMPORT_ROWS} rows at a time.` };

  const valid: ContactInput[] = [];
  const rowErrors: { row: number; message: string }[] = [];
  list.data.forEach((raw, i) => {
    const r = importRowSchema.safeParse(raw);
    if (r.success) valid.push(r.data);
    else rowErrors.push({ row: i + 2, message: r.error.issues[0]?.message ?? "This row isn't valid." });
  });
  if (rowErrors.length) return { ok: false, message: "Fix these rows, then import again.", rowErrors };
  if (!valid.length) return { ok: false, message: "There are no rows to import." };

  const ctx = await writableWorkspace(slug).catch(() => null);
  if (!ctx) return { ok: false, message: "Your role can't import clients." };
  const supabase = await createServerClient();

  const companyIds = new Map<string, string | null>();
  try {
    for (const name of new Set(valid.map((v) => v.company).filter((c): c is string => !!c))) {
      companyIds.set(name.toLowerCase(), await companyId(supabase, ctx.workspace.id, name));
    }
  } catch {
    return { ok: false, message: "Couldn't create the companies in this file." };
  }

  const { error } = await supabase.from("contacts").insert(
    valid.map((v) => ({
      workspace_id: ctx.workspace.id,
      name: v.name,
      email: v.email,
      phone: v.phone,
      address: v.address,
      company_id: v.company ? (companyIds.get(v.company.toLowerCase()) ?? null) : null,
    })),
  );
  if (error) return { ok: false, message: "The import didn't go through. Nothing was added." };
  revalidatePath(`/${slug}/clients`);
  return { ok: true, added: valid.length };
}
