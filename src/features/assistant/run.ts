import "server-only";
import { z } from "zod";
import { runChat } from "@/lib/ai/chat";
import { AiProviderError } from "@/lib/ai/types";
import { rateLimit } from "@/lib/rate-limit";
import { todaySAST } from "@/lib/dates";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import { getProvider } from "@/server/ai/provider";
import type { AskInput } from "./schema";
import { buildSystemPrompt } from "./schema";
import { buildTools } from "./tools";

type Db = Awaited<ReturnType<typeof createServerClient>>;
export type AiKind = "chat" | "receipt" | "summary";

const taken = z.object({ used: z.number(), limit: z.number(), usage_id: z.uuid() });

export type Taken = { ok: true; used: number; limit: number; usageId: string } | { ok: false; message: string };

/**
 * Counts one request against the business's monthly allowance (the database decides, see migration 0034).
 * Always paired with `give back` when the provider fails.
 */
export async function takeAi(db: Db, workspaceId: string, kind: AiKind): Promise<Taken> {
  const { data, error } = await db.rpc("ai_take", { p_workspace: workspaceId, p_kind: kind });
  if (error) {
    // LDG01 = used up (monthly or daily), LDG03 = switched off: both carry a message written for people.
    const own = (error.code === "LDG01" || error.code === "LDG03") && error.message;
    return { ok: false, message: own || "Couldn't start that. Please try again." };
  }
  const parsed = taken.safeParse(data);
  if (!parsed.success) return { ok: false, message: "Couldn't start that. Please try again." };
  return { ok: true, used: parsed.data.used, limit: parsed.data.limit, usageId: parsed.data.usage_id };
}

export async function giveBackAi(db: Db, usageId: string): Promise<void> {
  await db.rpc("ai_release", { p_id: usageId });
}

export function friendlyAiError(e: unknown): string {
  if (e instanceof AiProviderError) {
    if (e.kind === "timeout") return "The AI helper took too long. Please try again in a moment.";
    if (e.kind === "unavailable") return "The AI helper is busy right now. Please try again in a few minutes.";
    return "The AI helper couldn't answer that. Please try again later.";
  }
  return "The AI helper couldn't answer that. Please try again later.";
}

export type AssistantResult = { status: "ok"; reply: string; used: number; limit: number } | { status: "error"; message: string };

export async function runAssistant(ctx: WorkspaceContext, input: AskInput, kind: "chat" | "summary" = "chat"): Promise<AssistantResult> {
  const provider = getProvider();
  if (!provider) return { status: "error", message: "The AI helper isn't set up on this server yet." };
  if (!(await rateLimit("ai-user", ctx.user.id, 10, 60))) return { status: "error", message: "That's a lot of questions at once. Please wait a minute." };

  const db = await createServerClient();
  const t = await takeAi(db, ctx.workspace.id, kind);
  if (!t.ok) return { status: "error", message: t.message };

  try {
    const today = todaySAST();
    const { reply } = await runChat({
      provider,
      tools: buildTools(db, ctx.workspace.id, today),
      messages: [
        { role: "system", content: buildSystemPrompt({ business: ctx.workspace.name, today }) },
        ...input.history,
        { role: "user", content: input.question },
      ],
    });
    return { status: "ok", reply, used: t.used, limit: t.limit };
  } catch (e) {
    await giveBackAi(db, t.usageId).catch(() => undefined);
    return { status: "error", message: friendlyAiError(e) };
  }
}
