import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import type { OpenInvoice } from "./parse";

const lineRow = z.object({
  id: z.uuid(),
  posted_on: z.string(),
  amount_cents: z.coerce.number(),
  description: z.string(),
  status: z.enum(["new", "matched", "expense", "ignored"]),
  document_id: z.uuid().nullable(),
  expense_id: z.uuid().nullable(),
  sales_documents: z.object({ number: z.string().nullable() }).nullable(),
});
export type BankLineRow = z.infer<typeof lineRow>;

/** Statement lines, newest first; "todo" shows only what still needs a decision. */
export async function listBankLines(ctx: WorkspaceContext, view: "todo" | "all"): Promise<BankLineRow[]> {
  const supabase = await createServerClient();
  let q = supabase
    .from("bank_lines")
    .select("id, posted_on, amount_cents, description, status, document_id, expense_id, sales_documents(number)")
    .eq("workspace_id", ctx.workspace.id)
    .order("posted_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);
  if (view === "todo") q = q.eq("status", "new");
  const { data } = await q;
  return z.array(lineRow).catch([]).parse(data ?? []);
}

export async function countTodo(ctx: WorkspaceContext): Promise<number> {
  const supabase = await createServerClient();
  const { count } = await supabase
    .from("bank_lines")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspace.id)
    .eq("status", "new");
  return count ?? 0;
}

/** Sent, unpaid invoices with what is still owed: the candidates for money in. */
export async function openInvoices(ctx: WorkspaceContext): Promise<(OpenInvoice & { client: string })[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("sales_documents")
    .select("id, number, total_cents, paid_cents, credited_cents, contacts(name)")
    .eq("workspace_id", ctx.workspace.id)
    .eq("kind", "invoice")
    .in("status", ["sent", "viewed", "part_paid"])
    .order("due_date")
    .limit(300);
  const rows = z
    .array(
      z.object({
        id: z.uuid(),
        number: z.string().nullable(),
        total_cents: z.coerce.number(),
        paid_cents: z.coerce.number(),
        credited_cents: z.coerce.number(),
        contacts: z.object({ name: z.string() }).nullable(),
      }),
    )
    .catch([])
    .parse(data ?? []);
  return rows
    .map((r) => ({ id: r.id, number: r.number ?? "", owedCents: r.total_cents - r.paid_cents - r.credited_cents, client: r.contacts?.name ?? "" }))
    .filter((r) => r.owedCents > 0 && r.number);
}

export async function listImports(ctx: WorkspaceContext): Promise<{ id: string; file_name: string; added_count: number; created_at: string }[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("bank_imports")
    .select("id, file_name, added_count, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false })
    .limit(10);
  return z
    .array(z.object({ id: z.uuid(), file_name: z.string(), added_count: z.coerce.number(), created_at: z.string() }))
    .catch([])
    .parse(data ?? []);
}
