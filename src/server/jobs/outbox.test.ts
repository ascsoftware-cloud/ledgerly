import { describe, expect, test } from "vitest";
import { buildDocumentEmail, escapeHtml } from "./email-template";
import { processOutbox, type OutboxRow } from "./outbox-core";
import { resendTransport } from "./transport";

const doc = {
  kind: "invoice" as const,
  number: "INV-0007",
  businessName: "Alice <Tiling> & Co",
  clientName: "Thandi",
  totalCents: 185000,
  balanceCents: 185000,
  dueDate: "2026-11-26",
  link: "https://business.ascsoftware.co.za/p/abcdefghijklmnopqrstuvwxyz012345",
  message: "Hi <script>alert(1)</script>\nThanks!",
};

describe("escapeHtml", () => {
  test("neutralises markup", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("buildDocumentEmail", () => {
  const e = buildDocumentEmail(doc);
  test("subject names the document and the business", () => {
    expect(e.subject).toBe("Invoice INV-0007 from Alice <Tiling> & Co");
  });
  test("whatever the business typed cannot inject HTML", () => {
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("Alice &lt;Tiling&gt; &amp; Co");
  });
  test("has the amount, due date and link in both versions", () => {
    for (const body of [e.html, e.text]) {
      expect(body).toContain("R 1 850,00");
      expect(body).toContain("26 Nov 2026");
      expect(body).toContain(doc.link);
    }
  });
  test("quotes say view-and-accept, not pay", () => {
    expect(buildDocumentEmail({ ...doc, kind: "quote", number: "QUO-0001" }).text).toMatch(/view and accept/i);
  });
});

const row = (id: string): OutboxRow => ({
  id,
  workspace_id: "1e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e",
  template: "document",
  to_address: "thandi@client.test",
  reply_to: "alice@biz.test",
  payload: { document_id: "8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e", message: null },
});

describe("processOutbox", () => {
  test("sends each claimed message once and records the result", async () => {
    const finished: unknown[] = [];
    const sent: unknown[] = [];
    const result = await processOutbox({
      claim: async () => [row("a"), row("b")],
      load: async () => doc,
      send: async (m) => {
        sent.push(m.idempotencyKey);
        return m.idempotencyKey === "a" ? { ok: true, id: "re_1" } : { ok: false, error: "503" };
      },
      finish: async (...args) => void finished.push(args),
    });
    expect(sent).toEqual(["a", "b"]);
    expect(finished).toEqual([
      ["a", true, "re_1", null],
      ["b", false, null, "503"],
    ]);
    expect(result).toEqual({ sent: 1, failed: 1 });
  });

  test("the loader is asked for the document within the message's own workspace", async () => {
    const asked: unknown[] = [];
    await processOutbox({
      claim: async () => [row("a")],
      load: async (...args) => {
        asked.push(args);
        return doc;
      },
      send: async () => ({ ok: true, id: "x" }),
      finish: async () => {},
    });
    expect(asked).toEqual([["8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e", "1e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e", null]]);
  });

  test("a document that no longer exists fails that message, not the batch", async () => {
    const finished: unknown[] = [];
    await processOutbox({
      claim: async () => [row("a")],
      load: async () => null,
      send: async () => ({ ok: true, id: "x" }),
      finish: async (...args) => void finished.push(args),
    });
    expect(finished).toEqual([["a", false, null, "Document not found"]]);
  });
});

describe("resendTransport", () => {
  test("posts to Resend with the outbox id as the idempotency key", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const send = resendTransport({
      apiKey: "re_test",
      from: "Ledgerly <hello@mail.example.co.za>",
      fetch: async (url, init) => {
        seen = { url: String(url), init: init! };
        return new Response(JSON.stringify({ id: "re_42" }), { status: 200 });
      },
    });
    const r = await send({ to: "t@x.test", replyTo: "a@b.test", subject: "S", html: "<p>h</p>", text: "h", idempotencyKey: "row-1" });
    expect(r).toEqual({ ok: true, id: "re_42" });
    expect(seen!.url).toBe("https://api.resend.com/emails");
    const headers = new Headers(seen!.init.headers);
    expect(headers.get("Authorization")).toBe("Bearer re_test");
    expect(headers.get("Idempotency-Key")).toBe("row-1");
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ to: ["t@x.test"], reply_to: "a@b.test", subject: "S" });
  });

  test("an error response becomes a retryable failure without leaking the key", async () => {
    const send = resendTransport({
      apiKey: "re_secret_value",
      from: "x <x@y.co.za>",
      fetch: async () => new Response(JSON.stringify({ message: "Rate limit" }), { status: 429 }),
    });
    const r = await send({ to: "t@x.test", replyTo: null, subject: "S", html: "h", text: "h", idempotencyKey: "k" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("re_secret_value");
    expect(JSON.stringify(r)).toContain("429");
  });
});
