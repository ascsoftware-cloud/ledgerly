import "server-only";
import { z } from "zod";
import { isQuestKey, type QuestKey } from "@/features/quest/catalogue";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

export type DashboardData = {
  quest: { key: QuestKey; done: boolean }[];
  goalCents: number;
  streakDays: number;
  xp: number;
};

const questRows = z.array(z.object({ key: z.string(), completed_at: z.string().nullable() }));
const goalRow = z.object({ target_cents: z.coerce.number() }).nullable();
const streakRow = z.object({ current_days: z.number() }).nullable();
const xpRows = z.array(z.object({ points: z.number() }));

/** Everything the home screen shows, in one round of parallel queries (RLS applies). */
export async function getDashboard(ctx: WorkspaceContext): Promise<DashboardData> {
  const supabase = await createServerClient();
  const ws = ctx.workspace.id;

  const [quest, goal, streak, xp] = await Promise.all([
    supabase.from("quest_steps").select("key, completed_at").eq("workspace_id", ws).order("position"),
    supabase.from("goals").select("target_cents").eq("workspace_id", ws).eq("kind", "monthly_revenue").maybeSingle(),
    supabase.from("streaks").select("current_days").eq("workspace_id", ws).eq("user_id", ctx.user.id).maybeSingle(),
    supabase.from("xp_events").select("points").eq("workspace_id", ws).eq("user_id", ctx.user.id),
  ]);

  return {
    quest: questRows
      .catch([])
      .parse(quest.data ?? [])
      .filter((q) => isQuestKey(q.key))
      .map((q) => ({ key: q.key as QuestKey, done: q.completed_at !== null })),
    goalCents: goalRow.catch(null).parse(goal.data ?? null)?.target_cents ?? 1000000,
    streakDays: streakRow.catch(null).parse(streak.data ?? null)?.current_days ?? 0,
    xp: xpRows
      .catch([])
      .parse(xp.data ?? [])
      .reduce((sum, e) => sum + e.points, 0),
  };
}
