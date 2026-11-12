"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { fingerprintKeys } from "./parse";

const lineSchema = z.object({
  postedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 100_000_000_000),
  description: z.string().max(300),
});
const importSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  lines: z.array(lineSchema).min(1, "No transactions to import.").max(5000, "Import up to 5 000 lines at a time."),
});

async function managers(slug: string) {
  const ctx = await requireWorkspace(slug);
  return ctx.role === "owner" || ctx.role === "admin" ? ctx : null;
}

const done = (slug: string) => {
  revalidatePath(`/${slug}/money/bank`);
  revalidatePath(`/${slug}/money/expenses`);
  revalidatePath(`/${slug}/money`);
};

export async function importStatement(
  slug: string,
  input: { fileName: string; lines: { postedOn: string; amountCents: number; description: string }[] },
): Promise<{ ok: true; added: number; duplicates: number } | { ok: false; message: string }> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That file couldn't be read." };
  const ctx = await managers(slug);
  if (!ctx) return { ok: false, message: "Only owners and admins can import bank statements." };
  const keys = fingerprintKeys(parsed.data.lines);
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("import_bank_lines", {
    p_workspace: ctx.workspace.id,
    p_file_name: parsed.data.fileName,
    p_lines: parsed.data.lines.map((l, i) => ({ posted_on: l.postedOn, amount_cents: l.amountCents, description: l.description, key: keys[i] })),
  });
  if (error || !data) return { ok: false, message: "Couldn't import that statement. Nothing was added." };
  done(slug);
  const r = data as { added: number; duplicates: number };
  return { ok: true, added: r.added, duplicates: r.duplicates };
}

type Result = { ok: boolean; message?: string };
const failure = (error: { code?: string; message?: string } | null): Result => ({
  ok: false,
  message: error?.code === "LDG03" ? error.message : "Couldn't do that. Try again.",
});

export async function matchLine(slug: string, lineId: string, documentId: string): Promise<Result> {
  if (!z.uuid().safeParse(lineId).success || !z.uuid().safeParse(documentId).success) return { ok: false };
  if (!(await managers(slug))) return { ok: false, message: "Only owners and admins can do this." };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("match_bank_line", { p_line: lineId, p_doc: documentId });
  if (error) return failure(error);
  done(slug);
  return { ok: true };
}

export async function lineToExpense(slug: string, lineId: string, categoryId: string | null): Promise<Result> {
  if (!z.uuid().safeParse(lineId).success || (categoryId !== null && !z.uuid().safeParse(categoryId).success)) return { ok: false };
  if (!(await managers(slug))) return { ok: false, message: "Only owners and admins can do this." };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("bank_line_to_expense", { p_line: lineId, p_category: categoryId });
  if (error) return failure(error);
  done(slug);
  return { ok: true };
}

export async function ignoreLine(slug: string, lineId: string, ignored: boolean): Promise<Result> {
  if (!z.uuid().safeParse(lineId).success) return { ok: false };
  if (!(await managers(slug))) return { ok: false, message: "Only owners and admins can do this." };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_bank_line_ignored", { p_line: lineId, p_ignored: ignored === true });
  if (error) return failure(error);
  done(slug);
  return { ok: true };
}
