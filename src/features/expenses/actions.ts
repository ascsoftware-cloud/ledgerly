"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { CADENCES, type Cadence, expenseSchema, MAX_RECEIPT_BYTES, nextOccurrence, RECEIPT_TYPES } from "./schema";

export type ExpenseFormResult =
  | { status: "idle" }
  | { status: "saved"; id: string; message: string }
  | { status: "error"; message: string };

/** Creates (expenseId null) or updates an expense, with an optional receipt stored privately. */
export async function saveExpense(slug: string, expenseId: string | null, _prev: ExpenseFormResult, form: FormData): Promise<ExpenseFormResult> {
  if (expenseId !== null && !z.uuid().safeParse(expenseId).success) return { status: "error", message: "That expense doesn't exist." };
  const parsed = expenseSchema.safeParse({
    amount: form.get("amount") ?? "",
    spentOn: form.get("spentOn") ?? "",
    supplier: form.get("supplier") ?? "",
    categoryId: form.get("categoryId") ?? "",
    includesVat: form.get("includesVat") ?? undefined,
    method: form.get("method") ?? "",
    description: form.get("description") ?? "",
    requestId: form.get("requestId"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await requireWorkspace(slug);
  if (ctx.role === "accountant") return { status: "error", message: "Your role can view expenses but not change them." };

  const file = form.get("receipt");
  const hasFile = file instanceof File && file.size > 0;
  if (hasFile) {
    if (!RECEIPT_TYPES[file.type]) return { status: "error", message: "A receipt can be a photo (JPG, PNG, WebP) or a PDF." };
    if (file.size > MAX_RECEIPT_BYTES) return { status: "error", message: "That file is over 5 MB." };
  }

  const v = parsed.data;
  const fields = {
    spent_on: v.spentOn,
    amount_cents: v.amountCents,
    vat_cents: v.vatCents,
    supplier: v.supplier || null,
    description: v.description || null,
    category_id: v.categoryId,
    payment_method: v.method,
  };
  const supabase = await createServerClient();

  let id = expenseId;
  if (id === null) {
    // One expense per form opening: a double tap or a retry finds the first one.
    const key = `manual:${v.requestId}`;
    const { data: inserted, error } = await supabase
      .from("expenses")
      .upsert({ workspace_id: ctx.workspace.id, idempotency_key: key, ...fields }, { onConflict: "idempotency_key", ignoreDuplicates: true })
      .select("id");
    if (error) return { status: "error", message: error.code === "23503" ? "Choose a category from the list." : "Couldn't save the expense." };
    const { data } = await supabase.from("expenses").select("id").eq("idempotency_key", key).maybeSingle();
    if (!data) return { status: "error", message: "Couldn't save the expense." };
    id = data.id as string;

    // "This repeats": only on the first save of this form, and only owners/admins (RLS agrees).
    const repeat = form.get("repeat");
    if (inserted?.length && typeof repeat === "string" && repeat in CADENCES && (ctx.role === "owner" || ctx.role === "admin")) {
      const cadence = repeat as Cadence;
      const anchor = Number(v.spentOn.slice(8, 10));
      await supabase.from("recurring_costs").insert({
        workspace_id: ctx.workspace.id,
        supplier: v.supplier || "Repeating cost",
        description: v.description || null,
        amount_cents: v.amountCents,
        vat_cents: v.vatCents,
        category_id: v.categoryId,
        cadence,
        next_date: nextOccurrence(v.spentOn, cadence, anchor),
        anchor_day: anchor,
      });
    }
  } else {
    const { data, error } = await supabase
      .from("expenses")
      .update(fields)
      .eq("id", id)
      .eq("workspace_id", ctx.workspace.id)
      .select("id")
      .maybeSingle();
    if (error || !data) return { status: "error", message: "Couldn't save the expense." };
  }

  if (hasFile) {
    const path = `${ctx.workspace.id}/${id}/${randomUUID()}.${RECEIPT_TYPES[file.type]}`;
    const { error: upErr } = await supabase.storage.from("receipts").upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) return { status: "saved", id, message: "Expense saved, but the receipt didn't upload. Try adding it again." };
    await supabase.from("expenses").update({ receipt_path: path }).eq("id", id).eq("workspace_id", ctx.workspace.id);
  }

  revalidatePath(`/${slug}/money/expenses`);
  revalidatePath(`/${slug}`);
  return { status: "saved", id, message: expenseId ? "Expense updated." : "Expense logged." };
}

/** Archive (undo-able for 30 days) or restore an expense. */
export async function setExpenseArchived(slug: string, expenseId: string, archived: boolean): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(expenseId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (ctx.role === "accountant") return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("expenses")
    .update({ deleted_at: archived ? new Date().toISOString() : null })
    .eq("id", expenseId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();
  revalidatePath(`/${slug}/money/expenses`);
  return { ok: !!data };
}

/** A 60-second link to view one receipt. Storage rules check membership again. */
export async function receiptLink(slug: string, path: string): Promise<string | null> {
  const ctx = await requireWorkspace(slug);
  if (typeof path !== "string" || !path.startsWith(`${ctx.workspace.id}/`)) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.storage.from("receipts").createSignedUrl(path, 60);
  return data?.signedUrl ?? null;
}

/** Owner/admin: stop a repeating cost. Expenses already added stay. */
export async function stopRecurring(slug: string, recurringId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(recurringId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (ctx.role !== "owner" && ctx.role !== "admin") return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("recurring_costs")
    .update({ active: false })
    .eq("id", recurringId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();
  revalidatePath(`/${slug}/money/expenses`);
  return { ok: !!data };
}
