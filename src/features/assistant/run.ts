import "server-only";
import { runChat } from "@/lib/ai/chat";
import { AiProviderError } from "@/lib/ai/types";
import { rateLimit } from "@/lib/rate-limit";
import { todaySAST } from "@/lib/dates";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import { giveBackAi, takeAi } from "@/server/ai/allowance";
import { getProvider } from "@/server/ai/provider";
import type { AskInput } from "./schema";
import { buildSystemPrompt } from "./schema";
import { buildTools } from "./tools";

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
  const t = await takeAi(ctx.workspace.id, ctx.user.id, kind);
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
    await giveBackAi(t.usageId, ctx.user.id).catch(() => undefined);
    return { status: "error", message: friendlyAiError(e) };
  }
}
