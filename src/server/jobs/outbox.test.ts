import { describe, expect, test } from "vitest";
import { buildBookingEmail, buildDocumentEmail, escapeHtml } from "./email-template";
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

describe("booking emails", () => {
  const booking = {
    businessName: "Thandi's <Salon>",
    customerName: "Lerato Dube",
    serviceName: "Wash & blow-dry",
    startsAt: "2026-11-20T08:00:00.000Z",
    durationMin: 45,
    icsLink: "https://business.ascsoftware.co.za/book/thandis-salon/abc.ics",
  };
  const bookingRow = (id: string, template: "booking_confirmed" | "booking_reminder"): OutboxRow => ({
    ...row(id),
    template,
    payload: { booking_id: "9e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e" },
  });

  test("a confirmation names the service, the SAST time and the business, all escaped", () => {
    const e = buildBookingEmail(booking, "confirmed");
    expect(e.subject).toBe("Booked: Wash & blow-dry on Fri 20 Nov 2026, 10:00");
    expect(e.html).toContain("Thandi&#39;s &lt;Salon&gt;");
    expect(e.html).not.toContain("<Salon>");
    expect(e.text).toContain("45 minutes");
    expect(e.text).toContain(booking.icsLink);
  });

  test("a reminder says so", () => {
    expect(buildBookingEmail(booking, "reminder").subject).toBe("Reminder: Wash & blow-dry on Fri 20 Nov 2026, 10:00");
  });

  test("the worker sends booking emails from the booking's own workspace", async () => {
    const asked: unknown[] = [];
    const sent: string[] = [];
    await processOutbox({
      claim: async () => [bookingRow("c", "booking_confirmed"), bookingRow("r", "booking_reminder")],
      load: async () => null,
      loadBooking: async (...args) => {
        asked.push(args);
        return booking;
      },
      send: async (m) => {
        sent.push(m.subject);
        return { ok: true, id: "x" };
      },
      finish: async () => {},
    });
    expect(asked).toEqual([
      ["9e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e", "1e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e"],
      ["9e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e", "1e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e"],
    ]);
    expect(sent).toEqual(["Booked: Wash & blow-dry on Fri 20 Nov 2026, 10:00", "Reminder: Wash & blow-dry on Fri 20 Nov 2026, 10:00"]);
  });

  test("a reminder for a cancelled booking is dropped, not sent and not retried", async () => {
    const finished: unknown[] = [];
    let sends = 0;
    await processOutbox({
      claim: async () => [bookingRow("r", "booking_reminder")],
      load: async () => null,
      loadBooking: async () => "cancelled",
      send: async () => (sends++, { ok: true, id: "x" }),
      finish: async (...args) => void finished.push(args),
    });
    expect(sends).toBe(0);
    expect(finished).toEqual([["r", true, null, "skipped: booking cancelled"]]);
  });
});

describe("booking email greeting (the name is typed by a stranger)", () => {
  const b = (customerName: string) => ({
    businessName: "Thandi's Salon",
    customerName,
    serviceName: "Cut",
    startsAt: "2026-11-20T08:00:00.000Z",
    durationMin: 45,
    icsLink: "https://business.ascsoftware.co.za/book/x/abc.ics",
  });
  test("a normal first name is used", () => {
    expect(buildBookingEmail(b("Lerato Dube"), "confirmed").text).toContain("Hi Lerato,");
  });
  test("a link or odd text in the name is never placed in the greeting", () => {
    for (const name of ["www.evil.example/claim now", "http://evil.test win", "<b>Prize</b> claim", "$$$ WIN"]) {
      const e = buildBookingEmail(b(name), "confirmed");
      expect(e.text).toContain("Hi there,");
      expect(e.text).not.toMatch(/evil|WIN|Prize/);
      expect(e.html).not.toMatch(/evil|WIN|Prize/);
    }
  });
});

describe("team invitation emails", () => {
  const WS = "1e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e";
  const invite = (id: string): OutboxRow => ({
    ...row(id),
    template: "team_invite",
    to_address: "zed@team.test",
    payload: { invite_id: "7e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e", token: "tok_ABC-123" },
  });
  const loaded = { businessName: "Olga Plumbing", inviterName: "Olga", role: "staff" as const };

  test("the worker sends the invitation with the link built from the stored token, scoped to the workspace", async () => {
    const asked: unknown[] = [];
    const sent: { to: string; text: string }[] = [];
    await processOutbox({
      claim: async () => [invite("i1")],
      load: async () => null,
      loadInvite: async (...args) => {
        asked.push(args);
        return { ...loaded, link: `https://x.test/invite/${args[2]}` };
      },
      send: async (m) => {
        sent.push({ to: m.to, text: m.text });
        return { ok: true, id: "x" };
      },
      finish: async () => {},
    });
    expect(asked).toEqual([["7e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e", WS, "tok_ABC-123"]]);
    expect(sent[0]?.to).toBe("zed@team.test");
    expect(sent[0]?.text).toContain("https://x.test/invite/tok_ABC-123");
  });

  test("an invitation that is no longer open is dropped, not sent", async () => {
    const finished: unknown[] = [];
    let sends = 0;
    await processOutbox({
      claim: async () => [invite("i2")],
      load: async () => null,
      loadInvite: async () => "closed",
      send: async () => (sends++, { ok: true, id: "x" }),
      finish: async (...args) => void finished.push(args),
    });
    expect(sends).toBe(0);
    expect(finished).toEqual([["i2", true, null, "skipped: invitation no longer open"]]);
  });

  test("a missing invitation fails the message", async () => {
    const finished: unknown[] = [];
    await processOutbox({
      claim: async () => [invite("i3")],
      load: async () => null,
      loadInvite: async () => null,
      send: async () => ({ ok: true, id: "x" }),
      finish: async (...args) => void finished.push(args),
    });
    expect(finished).toEqual([["i3", false, null, "Invitation not found"]]);
  });
});

describe("customer portal emails", () => {
  const WS = "1e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e";
  const CONTACT = "5e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e";
  const portal = (id: string): OutboxRow => ({
    ...row(id),
    template: "portal_link",
    to_address: "thandi@client.test",
    payload: { contact_id: CONTACT, message: "Your documents" },
  });

  test("the worker builds the email from the client's current link, scoped to the workspace", async () => {
    const asked: unknown[] = [];
    const sent: string[] = [];
    await processOutbox({
      claim: async () => [portal("p1")],
      load: async () => null,
      loadPortal: async (...args) => {
        asked.push(args);
        return { businessName: "Olga Plumbing", clientName: "Thandi Mokoena", link: "https://x.test/portal/abc", message: "Your documents" };
      },
      send: async (m) => {
        sent.push(m.text);
        return { ok: true, id: "x" };
      },
      finish: async () => {},
    });
    expect(asked).toEqual([[CONTACT, WS, "Your documents"]]);
    expect(sent[0]).toContain("https://x.test/portal/abc");
  });

  test("a link that has been revoked since is dropped, not sent", async () => {
    const finished: unknown[] = [];
    let sends = 0;
    await processOutbox({
      claim: async () => [portal("p2")],
      load: async () => null,
      loadPortal: async () => "closed",
      send: async () => (sends++, { ok: true, id: "x" }),
      finish: async (...args) => void finished.push(args),
    });
    expect(sends).toBe(0);
    expect(finished).toEqual([["p2", true, null, "skipped: portal link no longer active"]]);
  });

  test("a missing client fails the message", async () => {
    const finished: unknown[] = [];
    await processOutbox({
      claim: async () => [portal("p3")],
      load: async () => null,
      loadPortal: async () => null,
      send: async () => ({ ok: true, id: "x" }),
      finish: async (...args) => void finished.push(args),
    });
    expect(finished).toEqual([["p3", false, null, "Client not found"]]);
  });
});
