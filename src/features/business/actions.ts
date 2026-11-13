"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { businessSchema } from "./schema";

export type BusinessResult = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string; field?: string };

/** Owners and admins change the business name and tax details. The database allows only them, too. */
export async function saveBusiness(slug: string, _prev: BusinessResult, form: FormData): Promise<BusinessResult> {
  const parsed = businessSchema.safeParse({
    name: String(form.get("name") ?? ""),
    registration: String(form.get("registration") ?? ""),
    vatRegistered: form.get("vatRegistered") === "on",
    vatNumber: String(form.get("vatNumber") ?? ""),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: "error", message: issue?.message ?? "Check the form.", field: String(issue?.path[0] ?? "") };
  }
  const ctx = await requireWorkspace(slug);
  if (ctx.role !== "owner" && ctx.role !== "admin") return { status: "error", message: "Only owners and admins can change the business details." };

  const v = parsed.data;
  const supabase = await createServerClient();
  const { data: renamed, error: nameError } = await supabase.from("workspaces").update({ name: v.name }).eq("id", ctx.workspace.id).select("id").maybeSingle();
  if (nameError || !renamed) return { status: "error", message: "Couldn't save the name. Please try again." };
  const { error } = await supabase
    .from("workspace_settings")
    .update({ business_name: v.name, registration_number: v.registration || null, vat_registered: v.vatRegistered, vat_number: v.vatNumber || null })
    .eq("workspace_id", ctx.workspace.id);
  if (error) return { status: "error", message: "The name was saved, but the tax details were not. Please try again." };
  revalidatePath(`/${slug}`, "layout");
  return { status: "saved", message: "Saved." };
}
