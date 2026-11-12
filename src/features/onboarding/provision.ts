"use server";

import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { answersSchema } from "./schema";

export type ProvisionResult = { ok: true; slug: string } | { ok: false; reason: "signed_out" | "failed" };

const result = z.object({ id: z.uuid(), slug: z.string(), created: z.boolean() });

/**
 * Creates (or finds) the signed-in user's workspace from their onboarding answers.
 * Answers that fail validation are treated as missing, so the user still gets a
 * working default workspace and is offered the questions again.
 */
export async function provisionWorkspace(raw: unknown): Promise<ProvisionResult> {
  const parsed = answersSchema.safeParse(raw);
  const answers = parsed.success ? parsed.data : null;

  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return { ok: false, reason: "signed_out" };

  const { data, error } = await supabase.rpc("provision_workspace", { answers });
  if (error) {
    console.error("Provisioning failed", { code: error.code });
    return { ok: false, reason: "failed" };
  }
  const r = result.safeParse(data);
  if (!r.success) return { ok: false, reason: "failed" };
  return { ok: true, slug: r.data.slug };
}
