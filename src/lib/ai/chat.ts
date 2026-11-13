import type { AiProvider, ChatMessage, Tool, ToolCall } from "./types";

export type { Tool } from "./types";

const FALLBACK = "Sorry, I couldn't come up with an answer to that. Please try asking in a different way.";

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…(cut)`;
}

/** Runs one tool call. Every failure becomes `{error}` for the MODEL to read; details never reach the person. */
async function runTool(call: ToolCall, tools: Tool[], maxChars: number): Promise<string> {
  const fail = (message: string) => JSON.stringify({ error: message });
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return fail("There is no such tool.");

  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments || "{}");
  } catch {
    return fail("The arguments were not valid JSON.");
  }
  const parsed = tool.schema.safeParse(raw);
  if (!parsed.success) return fail("The arguments did not match the tool's parameters.");

  try {
    const out = await tool.run(parsed.data);
    return cut(JSON.stringify(out ?? null), maxChars);
  } catch {
    return fail("The tool could not complete.");
  }
}

/**
 * The assistant's tool-calling loop. The model asks, we run read-only tools, hand the results back as data
 * (never as instructions), and stop after `maxSteps` rounds by asking for a plain answer with no tools.
 */
export async function runChat(opts: {
  provider: AiProvider;
  messages: ChatMessage[];
  tools: Tool[];
  maxSteps?: number;
  maxResultChars?: number;
}): Promise<{ reply: string }> {
  const { provider, tools } = opts;
  const maxSteps = opts.maxSteps ?? 4;
  const maxChars = opts.maxResultChars ?? 6000;
  const messages = [...opts.messages];
  const specs = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));

  for (let step = 0; step < maxSteps; step++) {
    const r = await provider.chat(messages, specs);
    if (r.toolCalls.length === 0) return { reply: r.content?.trim() || FALLBACK };
    messages.push({ role: "assistant", content: r.content, toolCalls: r.toolCalls });
    for (const call of r.toolCalls) {
      messages.push({ role: "tool", toolCallId: call.id, content: await runTool(call, tools, maxChars) });
    }
  }
  const last = await provider.chat(messages, []);
  return { reply: last.content?.trim() || FALLBACK };
}
