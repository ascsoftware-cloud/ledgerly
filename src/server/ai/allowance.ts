import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export type AiKind = "chat" | "receipt" | "summary";

const taken = z.object({ used: z.number(), limit: z.number(), usage_id: z.uuid() });

export type Taken = { ok: true; used: number; limit: number; usageId: string } | { ok: false; message: string };

/**
 * Counts one request against the business's monthly allowance (the database decides, see migrations 0034 and 0037).
 * Only the server may do this: the functions are not callable by signed-in people, so a person cannot skip the
 * limits by calling them directly. The caller has already proved membership with requireWorkspace; the database
 * checks it again. Always paired with `giveBackAi` when the provider fails.
 */
export async function takeAi(workspaceId: string, userId: string, kind: AiKind): Promise<Taken> {
  const generic = "Couldn't start that. Please try again.";
  try {
    const { data, error } = await createAdminClient().rpc("ai_take", { p_workspace: workspaceId, p_user: userId, p_kind: kind });
    if (error) {
      // LDG01 = used up (monthly or daily), LDG03 = switched off: both carry a message written for people.
      const own = (error.code === "LDG01" || error.code === "LDG03") && error.message;
      return { ok: false, message: own || generic };
    }
    const parsed = taken.safeParse(data);
    if (!parsed.success) return { ok: false, message: generic };
    return { ok: true, used: parsed.data.used, limit: parsed.data.limit, usageId: parsed.data.usage_id };
  } catch {
    return { ok: false, message: generic };
  }
}

export async function giveBackAi(usageId: string, userId: string): Promise<void> {
  await createAdminClient().rpc("ai_release", { p_id: usageId, p_user: userId });
}

