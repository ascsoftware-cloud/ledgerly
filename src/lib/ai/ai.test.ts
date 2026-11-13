import { describe, expect, test } from "vitest";
import { z } from "zod";
import { runChat, type Tool } from "./chat";
import { createGroqProvider } from "./groq";
import { parseReceipt } from "./receipt";
import { AiProviderError, type AiProvider, type ChatMessage, type ChatResult } from "./types";

/** A provider that plays back scripted answers and records what it was asked. */
function script(answers: ChatResult[]) {
  const calls: { messages: ChatMessage[]; tools: string[] }[] = [];
  const provider: AiProvider = {
    chat: async (messages, tools) => {
      calls.push({ messages: structuredClone(messages), tools: tools.map((t) => t.name) });
      const next = answers.shift();
      if (!next) throw new Error("script ran out");
      return next;
    },
    extractReceipt: async () => "{}",
  };
  return { provider, calls };
}

const lookup: Tool = {
  name: "lookup",
  description: "Looks something up",
  parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false },
  schema: z.strictObject({ q: z.string().min(1) }),
  run: async (a) => ({ found: (a as { q: string }).q.toUpperCase() }),
};

describe("runChat", () => {
  test("a plain answer comes straight back", async () => {
    const { provider } = script([{ content: "  Hello there  ", toolCalls: [] }]);
    const r = await runChat({ provider, messages: [{ role: "user", content: "hi" }], tools: [lookup] });
    expect(r.reply).toBe("Hello there");
  });

  test("a tool call is run, its result handed back as data, and the model answers from it", async () => {
    const { provider, calls } = script([
      { content: null, toolCalls: [{ id: "c1", name: "lookup", arguments: '{"q":"tile"}' }] },
      { content: "Found TILE", toolCalls: [] },
    ]);
    const r = await runChat({ provider, messages: [{ role: "user", content: "find tile" }], tools: [lookup] });
    expect(r.reply).toBe("Found TILE");
    const second = calls[1]!.messages;
    expect(second.at(-1)).toEqual({ role: "tool", toolCallId: "c1", content: '{"found":"TILE"}' });
    expect(second.at(-2)).toMatchObject({ role: "assistant", toolCalls: [{ id: "c1", name: "lookup" }] });
  });

  test("arguments that do not fit the tool's schema are refused, not run", async () => {
    let ran = 0;
    const strict: Tool = { ...lookup, run: async () => void ran++ };
    const { provider, calls } = script([
      { content: null, toolCalls: [{ id: "c1", name: "lookup", arguments: '{"q":"x","workspace_id":"someone-elses"}' }] },
      { content: "Sorry", toolCalls: [] },
    ]);
    await runChat({ provider, messages: [{ role: "user", content: "x" }], tools: [strict] });
    expect(ran).toBe(0);
    expect(JSON.parse((calls[1]!.messages.at(-1) as { content: string }).content)).toHaveProperty("error");
  });

  test("an unknown tool, bad JSON and a tool that throws are all reported to the model, not to the user", async () => {
    const boom: Tool = { ...lookup, name: "boom", run: async () => { throw new Error("db password is hunter2"); } };
    const { provider, calls } = script([
      { content: null, toolCalls: [
        { id: "a", name: "nope", arguments: "{}" },
        { id: "b", name: "lookup", arguments: "{not json" },
        { id: "c", name: "boom", arguments: '{"q":"x"}' },
      ] },
      { content: "Done", toolCalls: [] },
    ]);
    const r = await runChat({ provider, messages: [{ role: "user", content: "x" }], tools: [lookup, boom] });
    expect(r.reply).toBe("Done");
    const results = calls[1]!.messages.filter((m) => m.role === "tool").map((m) => (m as { content: string }).content);
    expect(results).toHaveLength(3);
    expect(results.join(" ")).not.toContain("hunter2");
    for (const x of results) expect(JSON.parse(x)).toHaveProperty("error");
  });

  test("a long tool result is cut so it cannot flood the model", async () => {
    const big: Tool = { ...lookup, name: "big", run: async () => "x".repeat(50_000) };
    const { provider, calls } = script([
      { content: null, toolCalls: [{ id: "a", name: "big", arguments: '{"q":"x"}' }] },
      { content: "ok", toolCalls: [] },
    ]);
    await runChat({ provider, messages: [{ role: "user", content: "x" }], tools: [big], maxResultChars: 500 });
    expect((calls[1]!.messages.at(-1) as { content: string }).content.length).toBeLessThanOrEqual(520);
  });

  test("a model that keeps calling tools is stopped and asked for a plain answer", async () => {
    const loop: ChatResult = { content: null, toolCalls: [{ id: "x", name: "lookup", arguments: '{"q":"a"}' }] };
    const { provider, calls } = script([loop, loop, loop, { content: "Here is what I found", toolCalls: [] }]);
    const r = await runChat({ provider, messages: [{ role: "user", content: "x" }], tools: [lookup], maxSteps: 3 });
    expect(r.reply).toBe("Here is what I found");
    expect(calls).toHaveLength(4);
    expect(calls[3]!.tools).toEqual([]);
  });

  test("an empty answer becomes a polite fallback", async () => {
    const { provider } = script([{ content: "   ", toolCalls: [] }]);
    const r = await runChat({ provider, messages: [{ role: "user", content: "x" }], tools: [] });
    expect(r.reply).toMatch(/couldn't/i);
  });

  test("provider errors pass through for the caller to handle", async () => {
    const provider: AiProvider = { chat: async () => { throw new AiProviderError("down", "unavailable"); }, extractReceipt: async () => "" };
    await expect(runChat({ provider, messages: [{ role: "user", content: "x" }], tools: [] })).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("the Groq adapter", () => {
  const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  test("sends an OpenAI-style request with the key, the model and the tools", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const p = createGroqProvider({
      apiKey: "gsk_secret",
      model: "m-chat",
      visionModel: "m-vision",
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(JSON.stringify({ choices: [{ message: { content: "hi", tool_calls: [{ id: "t1", type: "function", function: { name: "lookup", arguments: '{"q":"a"}' } }] } }] }));
      }) as unknown as typeof fetch,
    });
    const r = await p.chat([{ role: "system", content: "s" }, { role: "user", content: "u" }, { role: "assistant", content: null, toolCalls: [{ id: "t0", name: "lookup", arguments: "{}" }] }, { role: "tool", toolCallId: "t0", content: "{}" }], [{ name: "lookup", description: "d", parameters: { type: "object" } }]);
    expect(seen!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer gsk_secret");
    const body = JSON.parse(String(seen!.init.body));
    expect(body.model).toBe("m-chat");
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "lookup", description: "d", parameters: { type: "object" } } });
    expect(body.messages[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "t0", type: "function", function: { name: "lookup", arguments: "{}" } }] });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "t0", content: "{}" });
    expect(r).toEqual({ content: "hi", toolCalls: [{ id: "t1", name: "lookup", arguments: '{"q":"a"}' }] });
  });

  test("sends no tools field when there are none", async () => {
    let body: Record<string, unknown> = {};
    const p = createGroqProvider({ apiKey: "k", model: "m", visionModel: "v", fetch: (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] })); }) as unknown as typeof fetch });
    await p.chat([{ role: "user", content: "u" }], []);
    expect(body).not.toHaveProperty("tools");
  });

  test.each([
    [401, "rejected"],
    [403, "rejected"],
    [429, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
  ])("HTTP %i is a %s error that never includes the key or the body", async (status, kind) => {
    const p = createGroqProvider({ apiKey: "gsk_secret", model: "m", visionModel: "v", fetch: (async () => new Response("secret body gsk_secret", { status })) as unknown as typeof fetch });
    const err = await p.chat([{ role: "user", content: "u" }], []).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.kind).toBe(kind);
    expect(err.message).not.toContain("gsk_secret");
    expect(err.message).not.toContain("secret body");
  });

  test("a reply with the wrong shape is a bad_response", async () => {
    const p = createGroqProvider({ apiKey: "k", model: "m", visionModel: "v", fetch: ok({ nothing: true }) as unknown as typeof fetch });
    const err = await p.chat([{ role: "user", content: "u" }], []).catch((e) => e);
    expect(err.kind).toBe("bad_response");
  });

  test("a request that takes too long is a timeout", async () => {
    const p = createGroqProvider({
      apiKey: "k",
      model: "m",
      visionModel: "v",
      timeoutMs: 20,
      fetch: ((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch,
    });
    const err = await p.chat([{ role: "user", content: "u" }], []).catch((e) => e);
    expect(err.kind).toBe("timeout");
  });

  test("a receipt is sent as an image to the vision model", async () => {
    let body: { model: string; messages: { content: unknown }[] } | null = null;
    const p = createGroqProvider({ apiKey: "k", model: "m", visionModel: "m-vision", fetch: (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '{"total": 12.5}' } }] })); }) as unknown as typeof fetch });
    const raw = await p.extractReceipt({ base64: "AAAA", mime: "image/png" });
    expect(raw).toBe('{"total": 12.5}');
    expect(body!.model).toBe("m-vision");
    expect(JSON.stringify(body!.messages)).toContain("data:image/png;base64,AAAA");
  });
});

describe("parseReceipt", () => {
  test("reads the total, VAT, supplier and date from the model's JSON", () => {
    const r = parseReceipt('{"total": "R 1 150,00", "vat": 150, "supplier": "Engen Rivonia", "date": "2026-11-12"}');
    expect(r).toEqual({ ok: true, amountCents: 115000, vatCents: 15000, supplier: "Engen Rivonia", date: "2026-11-12" });
  });
  test("accepts numbers, fenced code and South African dates", () => {
    const r = parseReceipt('```json\n{"total": 45.5, "supplier": "  Makro ", "date": "12/11/2026"}\n```');
    expect(r).toEqual({ ok: true, amountCents: 4550, vatCents: 0, supplier: "Makro", date: "2026-11-12" });
  });
  test("missing optional parts are fine", () => {
    expect(parseReceipt('{"total": 10}')).toEqual({ ok: true, amountCents: 1000, vatCents: 0, supplier: null, date: null });
  });
  test.each(["not json at all", "{}", '{"total": "lots"}', '{"total": -5}', '{"total": 0}', '{"total": 99999999999999}', ""])("refuses %j", (raw) => {
    const r = parseReceipt(raw);
    expect(r.ok).toBe(false);
  });
  test("a VAT figure bigger than the total is ignored", () => {
    expect(parseReceipt('{"total": 10, "vat": 50}')).toMatchObject({ ok: true, vatCents: 0 });
  });
  test("a future or impossible date is dropped, and a long supplier cut", () => {
    const r = parseReceipt(JSON.stringify({ total: 10, supplier: "A".repeat(300), date: "2099-01-01" }));
    expect(r).toMatchObject({ ok: true, date: null });
    if (r.ok) expect(r.supplier!.length).toBeLessThanOrEqual(120);
  });
});
