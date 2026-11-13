import type { z } from "zod";

/** What the model is told a tool looks like (JSON Schema `parameters`). */
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

/** A tool the assistant may call. Arguments are untrusted model output: `schema` is the gate before `run`. */
export type Tool = ToolSpec & {
  schema: z.ZodType;
  run: (args: unknown) => Promise<unknown>;
};

export type ToolCall = { id: string; name: string; arguments: string };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type ChatResult = { content: string | null; toolCalls: ToolCall[] };

export type ReceiptImage = { base64: string; mime: string };

/** The only door to an AI service. Swappable: Groq today, a mock in tests. */
export interface AiProvider {
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResult>;
  /** Raw text the vision model returned for a receipt photo (parsed and checked by `parseReceipt`). */
  extractReceipt(image: ReceiptImage): Promise<string>;
}

export type AiErrorKind = "not_configured" | "rejected" | "unavailable" | "timeout" | "bad_response";

/** Messages are safe to show: they never carry the key, the request or the provider's reply body. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly kind: AiErrorKind,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
