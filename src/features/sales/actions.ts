"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { draftSchema } from "./schema";
import { sendErrorMessage } from "./status";

export type EditorState = { status: "idle" } | { status: "error"; message: string; field?: string };

async function writable(slug: string) {
  const ctx = await requireWorkspace(slug);
  return ctx.role === "accountant" ? null : ctx;
}

/** Saves the editor (and optionally sends). The form posts one JSON payload built by the editor. */
export async function saveDraft(slug: string, docId: string | null, _prev: EditorState, form: FormData): Promise<EditorState> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    return { status: "error", message: "Something went wrong reading the form. Refresh and try again." };
  }
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: "error", message: issue?.message ?? "Check the form.", field: String(issue?.path[0] ?? "") };
  }
  if (docId && !z.uuid().safeParse(docId).success) return { status: "error", message: "That draft doesn't exist." };
  const ctx = await writable(slug);
  if (!ctx) return { status: "error", message: "Your role can view documents but not change them." };

  const d = parsed.data;
  const supabase = await createServerClient();
  const { data: id, error } = await supabase.rpc("save_document_draft", {
    p_workspace: ctx.workspace.id,
    p_id: docId,
    p_doc: {
      kind: d.kind,
      contact_id: d.contactId,
      due_date: d.dueDate,
      notes: d.notes,
      deposit_type: d.deposit?.type ?? null,
      deposit_value: d.deposit?.value ?? null,
    },
    p_lines: d.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit_cents: l.unitCents,
      discount_pct: l.discountPct,
      vat_rate: l.vatRate,
    })),
  });
  if (error || typeof id !== "string") {
    if (error) console.error("save_document_draft failed", { code: error.code });
    return {
      status: "error",
      message: error?.code === "LDG02" ? (error.message ?? "Only drafts can be changed.") : "Couldn't save. Try again.",
    };
  }

  if (form.get("intent") === "send") {
    const { error: sendError } = await supabase.rpc("send_document", { p_id: id });
    if (sendError) {
      revalidatePath(`/${slug}/money`);
      return { status: "error", message: `Saved as a draft. ${sendErrorMessage(sendError)}` };
    }
  }
  revalidatePath(`/${slug}/money`);
  redirect(`/${slug}/money/${id}`);
}

export type ActionResult = { ok: true; number?: string } | { ok: false; message: string };

export async function sendDocument(slug: string, id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "That document doesn't exist." };
  const ctx = await writable(slug);
  if (!ctx) return { ok: false, message: "Your role can't send documents." };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("send_document", { p_id: id });
  if (error) return { ok: false, message: sendErrorMessage(error) };
  revalidatePath(`/${slug}/money`);
  revalidatePath(`/${slug}/money/${id}`);
  return { ok: true, number: (data as { number?: string } | null)?.number };
}

export async function deleteDraft(slug: string, id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "That draft doesn't exist." };
  const ctx = await writable(slug);
  if (!ctx) return { ok: false, message: "Your role can't delete drafts." };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from("sales_documents")
    .delete({ count: "exact" })
    .eq("workspace_id", ctx.workspace.id)
    .eq("id", id)
    .eq("status", "draft");
  if (error || count !== 1) return { ok: false, message: "Only drafts can be deleted." };
  revalidatePath(`/${slug}/money`);
  return { ok: true };
}

/** Runs one of the database's document functions, then opens the result. */
async function runAndOpen(slug: string, fn: "convert_quote_to_invoice" | "create_credit_note", arg: string, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "That document doesn't exist." } as const;
  const ctx = await writable(slug);
  if (!ctx) return { ok: false, message: "Your role can't do that." } as const;
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc(fn, { [arg]: id });
  if (error || typeof data !== "string") return { ok: false, message: sendErrorMessage(error) } as const;
  revalidatePath(`/${slug}/money`);
  redirect(`/${slug}/money/${data}/edit`);
}

export async function convertQuote(slug: string, id: string) {
  return runAndOpen(slug, "convert_quote_to_invoice", "p_quote", id);
}

export async function creditNote(slug: string, id: string) {
  return runAndOpen(slug, "create_credit_note", "p_invoice", id);
}

export async function voidDocument(slug: string, id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "That document doesn't exist." };
  const ctx = await writable(slug);
  if (!ctx) return { ok: false, message: "Your role can't void documents." };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("void_document", { p_id: id });
  if (error) return { ok: false, message: sendErrorMessage(error) };
  revalidatePath(`/${slug}/money/${id}`);
  return { ok: true };
}
