import "server-only";
import { createGroqProvider } from "@/lib/ai/groq";
import { createMockProvider } from "@/lib/ai/mock";
import type { AiProvider } from "@/lib/ai/types";

// Groq model names change; these are starting points, not verified without a key. Override with AI_MODEL / AI_VISION_MODEL.
// llama-3.3-70b-versatile was retired Aug 2026; openai/gpt-oss-120b is a current tool-capable model.
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b";

/** null when no provider is configured: the app then says the helper is not set up instead of failing. */
export function getProvider(): AiProvider | null {
  const kind = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (kind === "mock") return createMockProvider();
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey || (kind && kind !== "groq")) return null;
  return createGroqProvider({
    apiKey,
    model: process.env.AI_MODEL?.trim() || DEFAULT_MODEL,
    visionModel: process.env.AI_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL,
  });
}
