import "server-only";
import type { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import { agedSchema, cashSchema, pnlSchema, vatSchema, type Period, type ReportData, type ReportKind } from "./schema";

/**
 * Runs one report as the signed-in person. The database refuses anyone but owners, admins and
 * accountants, so this returns null for staff (and for any other business) rather than a partial answer.
 */
export async function loadReport(ctx: WorkspaceContext, kind: ReportKind, period: Period, today: string): Promise<ReportData | null> {
  const supabase = await createServerClient();
  const ws = ctx.workspace.id;
  const parse = <T extends z.ZodType>(schema: T, data: unknown): z.output<T> | null => {
    const r = schema.safeParse(data);
    return r.success ? r.data : null;
  };
  switch (kind) {
    case "pnl": {
      const { data } = await supabase.rpc("report_pnl", { p_ws: ws, p_from: period.from, p_to: period.to });
      const d = parse(pnlSchema, data);
      return d && { kind, data: d };
    }
    case "vat": {
      const { data } = await supabase.rpc("report_vat", { p_ws: ws, p_from: period.from, p_to: period.to });
      const d = parse(vatSchema, data);
      return d && { kind, data: d };
    }
    case "aged": {
      const { data } = await supabase.rpc("report_aged_debtors", { p_ws: ws, p_as_of: today });
      const d = parse(agedSchema, data);
      return d && { kind, data: d };
    }
    case "cashflow": {
      const { data } = await supabase.rpc("report_cashflow", { p_ws: ws, p_today: today });
      const d = parse(cashSchema, data);
      return d && { kind, data: d };
    }
  }
}
