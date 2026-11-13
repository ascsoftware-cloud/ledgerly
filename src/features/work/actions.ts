"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/lib/money";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { taskSchema } from "./views";

export type WorkFormResult = { status: "idle" } | { status: "saved"; id: string; message: string } | { status: "error"; message: string };

async function writers(slug: string) {
  const ctx = await requireWorkspace(slug);
  return ctx.role === "accountant" ? null : ctx;
}
const refresh = (slug: string) => revalidatePath(`/${slug}/work`, "layout");

const dbMessage = (code?: string) =>
  code === "23514" ? "That person isn't in this workspace, or subtasks go one level deep." : code === "23503" ? "Choose a project from the list." : "Couldn't save. Try again.";

/** New task (taskId null; optional parent for a subtask) or edit an existing one. */
export async function saveTask(
  slug: string,
  taskId: string | null,
  parentId: string | null,
  _prev: WorkFormResult,
  form: FormData,
): Promise<WorkFormResult> {
  for (const id of [taskId, parentId]) if (id !== null && !z.uuid().safeParse(id).success) return { status: "error", message: "That task doesn't exist." };
  const parsed = taskSchema.safeParse({
    title: form.get("title") ?? "",
    projectId: form.get("projectId") ?? "",
    assigneeId: form.get("assigneeId") ?? "",
    dueDate: form.get("dueDate") ?? "",
    priority: form.get("priority") ?? "normal",
    notes: form.get("notes") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await writers(slug);
  if (!ctx) return { status: "error", message: "Your role can view tasks but not change them." };
  const v = parsed.data;
  const fields = { title: v.title, project_id: v.projectId, assignee_id: v.assigneeId, due_date: v.dueDate, priority: v.priority, notes: v.notes || null };
  const supabase = await createServerClient();
  const q = taskId
    ? supabase.from("tasks").update(fields).eq("id", taskId).eq("workspace_id", ctx.workspace.id)
    : supabase.from("tasks").insert({ workspace_id: ctx.workspace.id, parent_id: parentId, ...fields });
  const { data, error } = await q.select("id").maybeSingle();
  if (error || !data) return { status: "error", message: dbMessage(error?.code) };
  refresh(slug);
  return { status: "saved", id: data.id as string, message: taskId ? "Task updated." : "Task added." };
}

/** One-line add from the task list: just a title (and the project being viewed). */
export async function quickAddTask(slug: string, title: string, projectId: string | null): Promise<{ ok: boolean; message?: string }> {
  const t = title.trim();
  if (!t) return { ok: false, message: "Type what needs doing." };
  if (t.length > 200) return { ok: false, message: "Keep it under 200 characters." };
  if (projectId !== null && !z.uuid().safeParse(projectId).success) return { ok: false };
  const ctx = await writers(slug);
  if (!ctx) return { ok: false, message: "Your role can view tasks but not add them." };
  const supabase = await createServerClient();
  const { error } = await supabase.from("tasks").insert({ workspace_id: ctx.workspace.id, title: t, project_id: projectId });
  if (error) return { ok: false, message: dbMessage(error.code) };
  refresh(slug);
  return { ok: true };
}

export async function setTaskStatus(slug: string, taskId: string, status: "todo" | "doing" | "done"): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(taskId).success || !["todo", "doing", "done"].includes(status)) return { ok: false };
  const ctx = await writers(slug);
  if (!ctx) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("tasks").update({ status }).eq("id", taskId).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
  refresh(slug);
  return { ok: !!data };
}

export async function deleteTask(slug: string, taskId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(taskId).success) return { ok: false };
  const ctx = await writers(slug);
  if (!ctx) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("tasks").delete().eq("id", taskId).eq("workspace_id", ctx.workspace.id).select("id");
  refresh(slug);
  return { ok: !!data?.length };
}

const projectSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(120),
  contactId: z
    .string()
    .optional()
    .transform((v, c) => {
      if (!v) return null;
      if (!z.uuid().safeParse(v).success) {
        c.addIssue({ code: "custom", message: "Choose a client from the list." });
        return z.NEVER;
      }
      return v;
    }),
  rate: z
    .string()
    .optional()
    .transform((v, c) => {
      if (!v?.trim()) return 0;
      const cents = parseAmount(v);
      if (cents === null || cents < 0 || cents > 10_000_000) {
        c.addIssue({ code: "custom", message: "Enter an hourly rate like 450 or 450,00, or leave it blank." });
        return z.NEVER;
      }
      return cents;
    }),
  status: z.enum(["active", "done"]).optional().default("active"),
  notes: z.string().trim().max(2000).optional().default(""),
});

export async function saveProject(slug: string, projectId: string | null, _prev: WorkFormResult, form: FormData): Promise<WorkFormResult> {
  if (projectId !== null && !z.uuid().safeParse(projectId).success) return { status: "error", message: "That project doesn't exist." };
  const parsed = projectSchema.safeParse({
    name: form.get("name") ?? "",
    contactId: form.get("contactId") ?? "",
    rate: form.get("rate") ?? "",
    status: form.get("status") ?? undefined,
    notes: form.get("notes") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await writers(slug);
  if (!ctx) return { status: "error", message: "Your role can view projects but not change them." };
  const v = parsed.data;
  const fields = { name: v.name, contact_id: v.contactId, hourly_rate_cents: v.rate, status: v.status, notes: v.notes || null };
  const supabase = await createServerClient();
  const q = projectId
    ? supabase.from("projects").update(fields).eq("id", projectId).eq("workspace_id", ctx.workspace.id)
    : supabase.from("projects").insert({ workspace_id: ctx.workspace.id, ...fields });
  const { data, error } = await q.select("id").maybeSingle();
  if (error || !data) return { status: "error", message: error?.code === "23503" ? "Choose a client from the list." : "Couldn't save the project." };
  refresh(slug);
  return { status: "saved", id: data.id as string, message: projectId ? "Project updated." : "Project created." };
}

/** Owners and admins archive or restore projects (tasks and time stay, hidden with the project). */
export async function setProjectArchived(slug: string, projectId: string, archived: boolean): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(projectId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (ctx.role !== "owner" && ctx.role !== "admin") return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("projects")
    .update({ deleted_at: archived ? new Date().toISOString() : null })
    .eq("id", projectId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();
  refresh(slug);
  return { ok: !!data };
}
