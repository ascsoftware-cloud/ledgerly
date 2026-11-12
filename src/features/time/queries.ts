import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

const entryRow = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  description: z.string().nullable(),
  billable: z.boolean(),
  invoice_id: z.uuid().nullable(),
  tasks: z.object({ title: z.string() }).nullable(),
  sales_documents: z.object({ number: z.string().nullable() }).nullable(),
});
export type TimeEntryRow = z.infer<typeof entryRow> & { minutes: number };

const minutesOf = (e: { started_at: string; ended_at: string | null }) =>
  e.ended_at ? Math.round((new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 60000) : 0;

/** A project's time, newest first. Running timers have 0 minutes until stopped. */
export async function listProjectTime(ctx: WorkspaceContext, projectId: string): Promise<TimeEntryRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("time_entries")
    .select("id, user_id, started_at, ended_at, description, billable, invoice_id, tasks(title), sales_documents(number)")
    .eq("workspace_id", ctx.workspace.id)
    .eq("project_id", projectId)
    .order("started_at", { ascending: false })
    .limit(300);
  return z
    .array(entryRow)
    .catch([])
    .parse(data ?? [])
    .map((e) => ({ ...e, minutes: minutesOf(e) }));
}

/** The signed-in person's running timer in this workspace, if any. */
export async function runningTimer(ctx: WorkspaceContext): Promise<{ id: string; started_at: string; project_id: string | null; description: string | null } | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("time_entries")
    .select("id, started_at, project_id, description")
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", ctx.user.id)
    .is("ended_at", null)
    .maybeSingle();
  const r = z.object({ id: z.uuid(), started_at: z.string(), project_id: z.uuid().nullable(), description: z.string().nullable() }).safeParse(data);
  return r.success ? r.data : null;
}
