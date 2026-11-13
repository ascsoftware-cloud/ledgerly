"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { ruleSchema } from "./schema";

export type FormResult = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

const manage = (role: string) => role === "owner" || role === "admin";

export async function createRule(slug: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const parsed = ruleSchema.safeParse({ name: form.get("name") ?? "", trigger: form.get("trigger") ?? "", threshold: form.get("threshold") ?? "", action: form.get("action") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await requireWorkspace(slug);
  if (!manage(ctx.role)) return { status: "error", message: "Only owners and admins can change automations." };
  const supabase = await createServerClient();
  const { error } = await supabase.from("automation_rules").insert({ workspace_id: ctx.workspace.id, ...parsed.data });
  if (error) return { status: "error", message: (error.code === "LDG03" || error.code === "LDG01") && error.message ? error.message : "Couldn't save the rule." };
  revalidatePath(`/${slug}/settings/automations`);
  return { status: "saved", message: "Rule added. It is checked every hour." };
}

export async function setRuleEnabled(slug: string, id: string, enabled: boolean): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(id).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!manage(ctx.role)) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("automation_rules").update({ enabled }).eq("id", id).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
  revalidatePath(`/${slug}/settings/automations`);
  return { ok: !!data };
}

export async function deleteRule(slug: string, id: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(id).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!manage(ctx.role)) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("automation_rules").delete().eq("id", id).eq("workspace_id", ctx.workspace.id).select("id");
  revalidatePath(`/${slug}/settings/automations`);
  return { ok: !!data?.length };
}
