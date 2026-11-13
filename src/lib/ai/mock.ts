import { todaySAST } from "../dates";
import type { AiProvider, ChatMessage } from "./types";

/**
 * A stand-in provider for tests and for trying the screens without a key (AI_PROVIDER=mock).
 * It is deterministic: it asks for the overdue-invoice tool when the question mentions money owed,
 * then words the tool's answer. It never contacts anything.
 */
export function createMockProvider(): AiProvider {
  return {
    async chat(messages: ChatMessage[], tools) {
      const last = messages.at(-1);
      if (last?.role === "tool") {
        try {
          const data = JSON.parse(last.content) as { count?: number; totalOwing?: string; error?: string };
          if (data.error) return { content: "Mock assistant: the lookup failed.", toolCalls: [] };
          return { content: `Mock assistant: ${data.count ?? 0} overdue invoice(s), ${data.totalOwing ?? "R 0,00"} owing.`, toolCalls: [] };
        } catch {
          return { content: "Mock assistant: I could not read that.", toolCalls: [] };
        }
      }
      const question = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      if (/owe|overdue|unpaid/i.test(question) && tools.some((t) => t.name === "overdue_invoices")) {
        return { content: null, toolCalls: [{ id: "mock-1", name: "overdue_invoices", arguments: "{}" }] };
      }
      if (/fail/i.test(question)) throw new Error("mock failure");
      return { content: `Mock assistant: you asked "${question.slice(0, 80)}".`, toolCalls: [] };
    },
    async extractReceipt() {
      return JSON.stringify({ total: 345.5, vat: 45.07, supplier: "Mock Hardware", date: todaySAST() });
    },
  };
}
