import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

const taskRow = z.object({
  id: z.uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  status: z.enum(["todo", "doing", "done"]),
  priority: z.enum(["low", "normal", "high"]),
  due_date: z.string().nullable(),
  project_id: z.uuid().nullable(),
  parent_id: z.uuid().nullable(),
  assignee_id: z.uuid().nullable(),
  projects: z.object({ name: z.string(), deleted_at: z.string().nullable() }).nullable(),
});
export type TaskRow = z.infer<typeof taskRow>;
const TASK = "id, title, notes, status, priority, due_date, project_id, parent_id, assignee_id, projects(name, deleted_at)";

/** The one query behind the list, board and calendar. Top-level tasks only; subtasks live on their task. */
export async function listTasks(ctx: WorkspaceContext, filter: { projectId?: string | null; mine?: boolean } = {}): Promise<TaskRow[]> {
  const supabase = await createServerClient();
  let q = supabase.from("tasks").select(TASK).eq("workspace_id", ctx.workspace.id).is("parent_id", null).order("created_at").limit(500);
  if (filter.projectId) q = q.eq("project_id", filter.projectId);
  if (filter.mine) q = q.eq("assignee_id", ctx.user.id);
  const { data } = await q;
  // Tasks of an archived project are hidden along with it.
  return z.array(taskRow).catch([]).parse(data ?? []).filter((t) => !t.projects?.deleted_at);
}

export async function getTask(ctx: WorkspaceContext, id: string): Promise<(TaskRow & { subtasks: TaskRow[] }) | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const [{ data }, { data: subs }] = await Promise.all([
    supabase.from("tasks").select(TASK).eq("workspace_id", ctx.workspace.id).eq("id", id).maybeSingle(),
    supabase.from("tasks").select(TASK).eq("workspace_id", ctx.workspace.id).eq("parent_id", id).order("created_at"),
  ]);
  const t = taskRow.safeParse(data);
  return t.success ? { ...t.data, subtasks: z.array(taskRow).catch([]).parse(subs ?? []) } : null;
}

const projectRow = z.object({
  id: z.uuid(),
  name: z.string(),
  contact_id: z.uuid().nullable(),
  hourly_rate_cents: z.coerce.number(),
  status: z.enum(["active", "done"]),
  notes: z.string().nullable(),
  contacts: z.object({ name: z.string() }).nullable(),
});
export type ProjectRow = z.infer<typeof projectRow>;
const PROJECT = "id, name, contact_id, hourly_rate_cents, status, notes, contacts(name)";

export async function listProjects(ctx: WorkspaceContext): Promise<ProjectRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("projects")
    .select(PROJECT)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .order("status")
    .order("created_at", { ascending: false })
    .limit(300);
  return z.array(projectRow).catch([]).parse(data ?? []);
}

export async function getProject(ctx: WorkspaceContext, id: string): Promise<ProjectRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.from("projects").select(PROJECT).eq("workspace_id", ctx.workspace.id).eq("id", id).is("deleted_at", null).maybeSingle();
  const p = projectRow.safeParse(data);
  return p.success ? p.data : null;
}

/** People a task can be assigned to: everyone in the workspace, by name. */
export async function listMembers(ctx: WorkspaceContext): Promise<{ id: string; name: string }[]> {
  const supabase = await createServerClient();
  const { data: members } = await supabase.from("memberships").select("user_id").eq("workspace_id", ctx.workspace.id);
  const ids = z.array(z.object({ user_id: z.uuid() })).catch([]).parse(members ?? []).map((m) => m.user_id);
  if (!ids.length) return [];
  const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  const names = new Map(z.array(z.object({ id: z.uuid(), full_name: z.string().nullable() })).catch([]).parse(profiles ?? []).map((p) => [p.id, p.full_name]));
  return ids
    .map((id) => ({ id, name: names.get(id)?.trim() || (id === ctx.user.id ? "Me" : "Team member") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listClientsForPicker(ctx: WorkspaceContext): Promise<{ id: string; name: string }[]> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("contacts").select("id, name").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).order("name").limit(500);
  return z.array(z.object({ id: z.uuid(), name: z.string() })).catch([]).parse(data ?? []);
}

export async function listArchivedProjects(ctx: WorkspaceContext): Promise<{ id: string; name: string }[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", ctx.workspace.id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(50);
  return z.array(z.object({ id: z.uuid(), name: z.string() })).catch([]).parse(data ?? []);
}
