import { z } from "zod";
import { formatMoney } from "@/lib/money";
import type { Tool } from "@/lib/ai/types";
import type { createServerClient } from "@/lib/supabase/server";
import { outstandingCents, shapeOverdue, type OverdueRow } from "./schema";

type Db = Awaited<ReturnType<typeof createServerClient>>;

const OPEN_STATUSES = ["sent", "viewed", "part_paid"];

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
const sum = (rows: { amount_cents: number | string }[] | null) => (rows ?? []).reduce((t, r) => t + Number(r.amount_cents), 0);

/**
 * The assistant's tools. All read-only, all fixed to ONE workspace by the code that builds them: the model
 * can never name a workspace, and the signed-in person's row-level security applies to every query.
 * Results carry names and amounts only: no emails, phone numbers or addresses leave the app.
 */
export function buildTools(db: Db, workspaceId: string, today: string): Tool[] {
  return [
    {
      name: "overdue_invoices",
      description: "Unpaid invoices that are past their due date, oldest first, with the client, days late and amount still owing.",
      parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
      schema: z.strictObject({ limit: z.number().int().min(1).max(20).optional() }),
      run: async (a) => {
        const limit = (a as { limit?: number }).limit ?? 10;
        const { data, error } = await db
          .from("sales_documents")
          .select("number, due_date, total_cents, paid_cents, credited_cents, contacts(name)")
          .eq("workspace_id", workspaceId)
          .eq("kind", "invoice")
          .in("status", OPEN_STATUSES)
          .lt("due_date", today)
          .order("due_date")
          .limit(100);
        if (error) throw new Error("query failed");
        const all = shapeOverdue((data ?? []) as unknown as OverdueRow[], today);
        const total = (data ?? []).reduce((t, r) => t + outstandingCents(r as unknown as OverdueRow), 0);
        const more = (data ?? []).length >= 100;
        return { count: all.length, totalOwing: formatMoney(total), invoices: all.slice(0, limit), ...(more ? { note: "Only the 100 oldest are counted; there may be more." } : {}) };
      },
    },
    {
      name: "money_summary",
      description: "This month so far: money received, expenses logged, and the total still owed on open invoices.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      schema: z.strictObject({}),
      run: async () => {
        const monthStart = `${today.slice(0, 8)}01`;
        const [paid, spent, open] = await Promise.all([
          db.from("payments").select("amount_cents").eq("workspace_id", workspaceId).gte("paid_on", monthStart).limit(2000),
          db.from("expenses").select("amount_cents").eq("workspace_id", workspaceId).is("deleted_at", null).gte("spent_on", monthStart).limit(2000),
          db
            .from("sales_documents")
            .select("total_cents, paid_cents, credited_cents")
            .eq("workspace_id", workspaceId)
            .eq("kind", "invoice")
            .in("status", OPEN_STATUSES)
            .limit(2000),
        ]);
        if (paid.error || spent.error || open.error) throw new Error("query failed");
        const owed = (open.data ?? []).reduce((t, r) => t + outstandingCents(r), 0);
        return {
          since: monthStart,
          received: formatMoney(sum(paid.data)),
          expenses: formatMoney(sum(spent.data)),
          stillOwedOnOpenInvoices: formatMoney(owed),
        };
      },
    },
    {
      name: "recent_expenses",
      description: "Expenses logged in the last few days: the total and the biggest suppliers.",
      parameters: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 90 } }, additionalProperties: false },
      schema: z.strictObject({ days: z.number().int().min(1).max(90).optional() }),
      run: async (a) => {
        const days = (a as { days?: number }).days ?? 30;
        const { data, error } = await db
          .from("expenses")
          .select("amount_cents, supplier")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .gte("spent_on", addDays(today, -days))
          .limit(1000);
        if (error) throw new Error("query failed");
        const bySupplier = new Map<string, number>();
        for (const r of data ?? []) bySupplier.set(r.supplier ?? "No supplier", (bySupplier.get(r.supplier ?? "No supplier") ?? 0) + Number(r.amount_cents));
        const top = [...bySupplier.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
        return { days, count: data?.length ?? 0, total: formatMoney(sum(data)), biggestSuppliers: top.map(([supplier, c]) => ({ supplier, total: formatMoney(c) })) };
      },
    },
    {
      name: "low_stock",
      description: "Tracked products that are at or below their re-order level.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      schema: z.strictObject({}),
      run: async () => {
        const { data, error } = await db
          .from("products")
          .select("name, stock_qty, reorder_level")
          .eq("workspace_id", workspaceId)
          .eq("track_stock", true)
          .is("deleted_at", null)
          .limit(500);
        if (error) throw new Error("query failed");
        const low = (data ?? []).filter((p) => Number(p.reorder_level) > 0 && Number(p.stock_qty) <= Number(p.reorder_level));
        return { count: low.length, products: low.slice(0, 20).map((p) => ({ product: p.name, inStock: Number(p.stock_qty), reorderAt: Number(p.reorder_level) })) };
      },
    },
  ];
}
