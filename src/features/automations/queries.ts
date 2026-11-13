import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import { ACTION_KEYS, TRIGGER_KEYS } from "./schema";

const ruleRow = z.object({
  id: z.uuid(),
  name: z.string(),
  trigger: z.enum(TRIGGER_KEYS),
  threshold: z.coerce.number(),
  action: z.enum(ACTION_KEYS),
  enabled: z.boolean(),
});
export type RuleRow = z.infer<typeof ruleRow>;

export async function listRules(ctx: WorkspaceContext): Promise<RuleRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("automation_rules").select("id, name, trigger, threshold, action, enabled").eq("workspace_id", ctx.workspace.id).order("created_at");
  return z.array(ruleRow).catch([]).parse(data ?? []);
}

const runRow = z.object({
  id: z.uuid(),
  outcome: z.enum(["done", "failed"]),
  detail: z.string().nullable(),
  created_at: z.string(),
  automation_rules: z.object({ name: z.string() }).nullable(),
});
export type RunRow = z.infer<typeof runRow>;

/** The latest firings across all rules: what happened and when. */
export async function listRuns(ctx: WorkspaceContext, limit = 50): Promise<RunRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("automation_runs")
    .select("id, outcome, detail, created_at, automation_rules(name)")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return z.array(runRow).catch([]).parse(data ?? []);
}
