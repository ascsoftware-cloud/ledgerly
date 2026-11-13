import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { getProvider } from "@/server/ai/provider";

const statusRow = z.object({ enabled: z.boolean(), limit: z.number(), used: z.number() });

export type AiStatus = { enabled: boolean; limit: number; used: number; /** A provider is set up on this server. */ configured: boolean };

/** Whether the helper is on for this business, and this month's allowance. Any member may ask. */
export async function getAiStatus(workspaceId: string): Promise<AiStatus> {
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("ai_status", { p_workspace: workspaceId });
  const parsed = statusRow.safeParse(data);
  return { ...(parsed.success ? parsed.data : { enabled: false, limit: 20, used: 0 }), configured: getProvider() !== null };
}
