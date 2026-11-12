"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { timeEntrySchema } from "./time";

type Result = { ok: boolean; message?: string };
const refresh = (slug: string, projectId: string) => revalidatePath(`/${slug}/work/projects/${projectId}`);

async function trackers(slug: string) {
  const ctx = await requireWorkspace(slug);
  return ctx.role === "accountant" ? null : ctx;
}

export async function startTimer(slug: string, projectId: string, description: string): Promise<Result> {
  if (!z.uuid().safeParse(projectId).success) return { ok: false };
  const ctx = await trackers(slug);
  if (!ctx) return { ok: false, message: "Your role can view time but not track it." };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("start_timer", {
    p_workspace: ctx.workspace.id,
    p_project: projectId,
    p_task: null,
    p_description: description.slice(0, 300),
  });
  if (error) return { ok: false, message: "Couldn't start the timer." };
  refresh(slug, projectId);
  return { ok: true };
}

export async function stopTimer(slug: string, projectId: string): Promise<Result> {
  if (!z.uuid().safeParse(projectId).success) return { ok: false };
  const ctx = await trackers(slug);
  if (!ctx) return { ok: false };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("stop_timer", { p_workspace: ctx.workspace.id });
  if (error) return { ok: false, message: "Couldn't stop the timer." };
  refresh(slug, projectId);
  return { ok: true };
}

export type LogTimeResult = { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

/** Time worked earlier, typed in: a date and a duration. Stored as starting 09:00 SAST that day. */
export async function logTime(slug: string, projectId: string, _prev: LogTimeResult, form: FormData): Promise<LogTimeResult> {
  if (!z.uuid().safeParse(projectId).success) return { status: "error", message: "That project doesn't exist." };
  const parsed = timeEntrySchema.safeParse({
    date: form.get("date") ?? "",
    duration: form.get("duration") ?? "",
    description: form.get("description") ?? "",
    billable: form.get("billable") ?? undefined,
    taskId: form.get("taskId") ?? "",
    requestId: form.get("requestId"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await trackers(slug);
  if (!ctx) return { status: "error", message: "Your role can view time but not log it." };
  const v = parsed.data;
  const start = new Date(`${v.date}T09:00:00+02:00`);
  const end = new Date(start.getTime() + v.minutes * 60_000);
  const supabase = await createServerClient();
  const { error } = await supabase.from("time_entries").insert({
    workspace_id: ctx.workspace.id,
    project_id: projectId,
    task_id: v.taskId,
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    description: v.description || null,
    billable: v.billable,
  });
  if (error) return { status: "error", message: error.code === "23503" ? "Choose a task from this project." : "Couldn't log the time." };
  refresh(slug, projectId);
  return { status: "saved" };
}

export async function deleteEntry(slug: string, projectId: string, entryId: string): Promise<Result> {
  if (!z.uuid().safeParse(entryId).success || !z.uuid().safeParse(projectId).success) return { ok: false };
  const ctx = await trackers(slug);
  if (!ctx) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("time_entries").delete().eq("id", entryId).eq("workspace_id", ctx.workspace.id).select("id");
  refresh(slug, projectId);
  return data?.length ? { ok: true } : { ok: false, message: "Only your own, un-billed time can be removed." };
}

/** Billable hours → a draft invoice, opened for checking before it is sent. */
export async function billHours(slug: string, projectId: string, entryIds: string[]): Promise<{ ok: true; invoiceId: string } | { ok: false; message: string }> {
  const ids = z.array(z.uuid()).min(1).max(500).safeParse(entryIds);
  if (!ids.success || !z.uuid().safeParse(projectId).success) return { ok: false, message: "Choose the hours to bill." };
  const ctx = await trackers(slug);
  if (!ctx) return { ok: false, message: "Your role can view time but not bill it." };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("invoice_time_entries", { p_project: projectId, p_entries: ids.data });
  if (error || typeof data !== "string") return { ok: false, message: error?.code === "LDG03" ? error.message : "Couldn't create the invoice." };
  refresh(slug, projectId);
  revalidatePath(`/${slug}/money`);
  return { ok: true, invoiceId: data };
}
