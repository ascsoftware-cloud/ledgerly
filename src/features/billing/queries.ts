import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import { readBillingEnv } from "@/server/billing/payfast-subscription";

const usageRow = z.object({ plan: z.enum(["free", "pro"]), storage_used: z.coerce.number(), documents_sent: z.coerce.number(), owned_workspaces: z.coerce.number() });
const subRow = z.object({ status: z.enum(["active", "cancelling", "cancelled"]), current_period_end: z.string() }).nullable();

export type PlanPage = {
  usage: { storageUsed: number; documentsSent: number; ownedWorkspaces: number };
  subscription: { status: "active" | "cancelling" | "cancelled"; periodEnd: string } | null;
  billingOn: boolean;
};

export async function getPlanPage(ctx: WorkspaceContext): Promise<PlanPage> {
  const supabase = await createServerClient();
  const [usage, sub] = await Promise.all([
    supabase.rpc("workspace_usage", { p_workspace: ctx.workspace.id }),
    // Owners only (row-level security); everyone else simply gets nothing.
    supabase.from("subscriptions").select("status, current_period_end").eq("workspace_id", ctx.workspace.id).maybeSingle(),
  ]);
  const u = usageRow.safeParse(usage.data);
  const s = subRow.safeParse(sub.data ?? null);
  return {
    usage: { storageUsed: u.success ? u.data.storage_used : 0, documentsSent: u.success ? u.data.documents_sent : 0, ownedWorkspaces: u.success ? u.data.owned_workspaces : 1 },
    subscription: s.success && s.data ? { status: s.data.status, periodEnd: s.data.current_period_end } : null,
    billingOn: readBillingEnv() !== null,
  };
}
