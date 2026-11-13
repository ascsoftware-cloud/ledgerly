import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

export type DeletionState = { workspaceOn: string | null; accountOn: string | null };

const plus7 = (iso: string | null | undefined) => (iso ? new Date(Date.parse(iso) + 7 * 86_400_000).toISOString() : null);

/** When (if ever) this business and this person's account are due to be deleted: for the notice at the top of the app. */
export async function getDeletionState(ctx: WorkspaceContext): Promise<DeletionState> {
  const supabase = await createServerClient();
  const [ws, me] = await Promise.all([
    supabase.from("workspaces").select("deletion_requested_at").eq("id", ctx.workspace.id).maybeSingle(),
    supabase.from("profiles").select("deletion_requested_at").eq("id", ctx.user.id).maybeSingle(),
  ]);
  return {
    workspaceOn: plus7((ws.data as { deletion_requested_at?: string | null } | null)?.deletion_requested_at),
    accountOn: plus7((me.data as { deletion_requested_at?: string | null } | null)?.deletion_requested_at),
  };
}
