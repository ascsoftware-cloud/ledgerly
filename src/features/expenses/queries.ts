import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

const expenseRow = z.object({
  id: z.uuid(),
  spent_on: z.string(),
  amount_cents: z.coerce.number(),
  vat_cents: z.coerce.number(),
  supplier: z.string().nullable(),
  description: z.string().nullable(),
  category_id: z.uuid().nullable(),
  payment_method: z.string().nullable(),
  receipt_path: z.string().nullable(),
  recurring_id: z.uuid().nullable(),
  deleted_at: z.string().nullable(),
  expense_categories: z.object({ name: z.string() }).nullable(),
});
export type ExpenseRow = z.infer<typeof expenseRow>;

const SELECT =
  "id, spent_on, amount_cents, vat_cents, supplier, description, category_id, payment_method, receipt_path, recurring_id, deleted_at, expense_categories(name)";

/** Expenses in one month ("2026-11"), newest first. RLS scopes to the workspace. */
export async function listExpenses(ctx: WorkspaceContext, month: string): Promise<ExpenseRow[]> {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const from = `${month}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("expenses")
    .select(SELECT)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .gte("spent_on", from)
    .lt("spent_on", to)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  return z.array(expenseRow).catch([]).parse(data ?? []);
}

export async function getExpense(ctx: WorkspaceContext, id: string): Promise<ExpenseRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.from("expenses").select(SELECT).eq("workspace_id", ctx.workspace.id).eq("id", id).maybeSingle();
  const parsed = expenseRow.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export type Category = { id: string; name: string };
export async function listCategories(ctx: WorkspaceContext): Promise<Category[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("expense_categories")
    .select("id, name")
    .eq("workspace_id", ctx.workspace.id)
    .order("name");
  return z.array(z.object({ id: z.uuid(), name: z.string() })).catch([]).parse(data ?? []);
}

const recurringRow = z.object({
  id: z.uuid(),
  supplier: z.string(),
  amount_cents: z.coerce.number(),
  cadence: z.enum(["weekly", "monthly", "yearly"]),
  next_date: z.string(),
});
export type RecurringRow = z.infer<typeof recurringRow>;

export async function listRecurring(ctx: WorkspaceContext): Promise<RecurringRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("recurring_costs")
    .select("id, supplier, amount_cents, cadence, next_date")
    .eq("workspace_id", ctx.workspace.id)
    .eq("active", true)
    .order("next_date");
  return z.array(recurringRow).catch([]).parse(data ?? []);
}
