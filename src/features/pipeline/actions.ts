"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/lib/money";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";

export type DealFormState = { status: "idle" | "saved" | "error"; message?: string };

const dealSchema = z.object({
  title: z.string().trim().min(1, "Give the deal a name.").max(120),
  value: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return 0;
      const cents = parseAmount(v);
      if (cents === null || cents < 0) {
        ctx.addIssue({ code: "custom", message: "Enter the value in rand, like 4 500 or 4500,00." });
        return z.NEVER;
      }
      return cents;
    }),
  stageId: z.uuid(),
  contactId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.uuid().nullable()),
});

async function writable(slug: string) {
  const ctx = await requireWorkspace(slug);
  return ctx.role === "accountant" ? null : ctx;
}

export async function addDeal(slug: string, _prev: DealFormState, form: FormData): Promise<DealFormState> {
  const parsed = dealSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const ctx = await writable(slug);
  if (!ctx) return { status: "error", message: "Your role can't add deals." };

  const supabase = await createServerClient();
  const { error } = await supabase.from("deals").insert({
    workspace_id: ctx.workspace.id,
    stage_id: parsed.data.stageId,
    contact_id: parsed.data.contactId,
    title: parsed.data.title,
    value_cents: parsed.data.value,
  });
  if (error) return { status: "error", message: "Couldn't add the deal. Try again." };
  revalidatePath(`/${slug}/clients/pipeline`);
  return { status: "saved" };
}

export async function moveDeal(slug: string, form: FormData): Promise<void> {
  const ids = z.object({ dealId: z.uuid(), stageId: z.uuid() }).safeParse(Object.fromEntries(form));
  if (!ids.success) return;
  const ctx = await writable(slug);
  if (!ctx) return;
  const supabase = await createServerClient();
  await supabase
    .from("deals")
    .update({ stage_id: ids.data.stageId })
    .eq("workspace_id", ctx.workspace.id)
    .eq("id", ids.data.dealId);
  revalidatePath(`/${slug}/clients/pipeline`);
}
