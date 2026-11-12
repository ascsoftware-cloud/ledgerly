import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

const stageRow = z.object({ id: z.uuid(), name: z.string(), position: z.number(), outcome: z.enum(["open", "won", "lost"]) });
const dealRow = z.object({
  id: z.uuid(),
  stage_id: z.uuid(),
  title: z.string(),
  value_cents: z.coerce.number(),
  contacts: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});

export type Stage = z.infer<typeof stageRow> & { deals: z.infer<typeof dealRow>[]; totalCents: number };

export async function getBoard(ctx: WorkspaceContext): Promise<Stage[]> {
  const supabase = await createServerClient();
  const ws = ctx.workspace.id;
  const [stages, deals] = await Promise.all([
    supabase.from("pipeline_stages").select("id, name, position, outcome").eq("workspace_id", ws).order("position"),
    supabase
      .from("deals")
      .select("id, stage_id, title, value_cents, contacts(id, name)")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  const all = z.array(dealRow).catch([]).parse(deals.data ?? []);
  return z
    .array(stageRow)
    .catch([])
    .parse(stages.data ?? [])
    .map((s) => {
      const inStage = all.filter((d) => d.stage_id === s.id);
      return { ...s, deals: inStage, totalCents: inStage.reduce((sum, d) => sum + d.value_cents, 0) };
    });
}

export async function contactOptions(ctx: WorkspaceContext): Promise<{ id: string; name: string }[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("contacts")
    .select("id, name")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .order("name")
    .limit(500);
  return z.array(z.object({ id: z.uuid(), name: z.string() })).catch([]).parse(data ?? []);
}
