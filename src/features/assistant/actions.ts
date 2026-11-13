"use server";

import { revalidatePath } from "next/cache";
import { parseReceipt } from "@/lib/ai/receipt";
import { rateLimit } from "@/lib/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { getProvider } from "@/server/ai/provider";
import { giveBackAi, takeAi } from "@/server/ai/allowance";
import { friendlyAiError, runAssistant, type AssistantResult } from "./run";
import { askSchema, receiptToForm } from "./schema";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** The vision API takes images up to about 4 MB once encoded; stay under it. */
const MAX_SCAN_BYTES = 3 * 1024 * 1024;

/** One question to the assistant. The workspace comes from the page the person is on, checked by their own membership. */
export async function askAssistant(slug: string, input: unknown): Promise<AssistantResult> {
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Type a question first." };
  const ctx = await requireWorkspace(slug);
  return runAssistant(ctx, parsed.data);
}

export type ScanResult =
  | { status: "ok"; amount: string; supplier: string; spentOn: string; includesVat: boolean }
  | { status: "error"; message: string };

/** Reads a receipt photo into expense-form values. Nothing is saved: the person checks and saves it. */
export async function scanReceipt(slug: string, form: FormData): Promise<ScanResult> {
  const file = form.get("receipt");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a photo of the receipt first." };
  if (!IMAGE_TYPES.has(file.type)) return { status: "error", message: "Scanning works on photos (JPG, PNG or WebP), not PDFs." };
  if (file.size > MAX_SCAN_BYTES) return { status: "error", message: "That photo is over 3 MB. Take it again a little smaller." };

  const ctx = await requireWorkspace(slug);
  if (ctx.role === "accountant") return { status: "error", message: "Your role can view expenses but not add them." };
  const provider = getProvider();
  if (!provider) return { status: "error", message: "The AI helper isn't set up on this server yet." };
  if (!(await rateLimit("ai-user", ctx.user.id, 10, 60))) return { status: "error", message: "That's a lot at once. Please wait a minute." };

  const t = await takeAi(ctx.workspace.id, ctx.user.id, "receipt");
  if (!t.ok) return { status: "error", message: t.message };

  let raw: string;
  try {
    raw = await provider.extractReceipt({ base64: Buffer.from(await file.arrayBuffer()).toString("base64"), mime: file.type });
  } catch (e) {
    await giveBackAi(t.usageId, ctx.user.id).catch(() => undefined);
    return { status: "error", message: friendlyAiError(e) };
  }
  const r = parseReceipt(raw);
  if (!r.ok) return { status: "error", message: "I couldn't read a total from that photo. You can type it in instead." };
  return { status: "ok", ...receiptToForm(r, true) };
}

/** Owners and admins switch the helper on or off for the business (the database enforces who). */
export async function setAiEnabled(slug: string, on: boolean): Promise<{ ok: boolean }> {
  const ctx = await requireWorkspace(slug);
  if (ctx.role !== "owner" && ctx.role !== "admin") return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("workspace_settings").update({ ai_enabled: on === true }).eq("workspace_id", ctx.workspace.id).select("workspace_id");
  revalidatePath(`/${slug}`, "layout");
  return { ok: !!data?.length };
}
