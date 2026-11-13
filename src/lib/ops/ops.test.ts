import { describe, expect, test } from "vitest";
import { buildSentryEnvelope, parseDsn, redact, safeRoute, scrubText } from "./report";
import { formatLog } from "./log";

describe("redact", () => {
  test("hides secrets, tokens, passwords, keys, emails and phone numbers by field name, at any depth", () => {
    const out = redact({
      ok: 1,
      email: "a@b.co",
      user: { phone: "+27821234567", name: "Thandi", api_key: "k", nested: [{ Authorization: "Bearer x" }] },
      password: "p",
      token: "t",
      secret: "s",
      cookie: "c",
      note: "kept",
    });
    expect(out).toEqual({
      ok: 1,
      email: "[hidden]",
      user: { phone: "[hidden]", name: "Thandi", api_key: "[hidden]", nested: [{ Authorization: "[hidden]" }] },
      password: "[hidden]",
      token: "[hidden]",
      secret: "[hidden]",
      cookie: "[hidden]",
      note: "kept",
    });
  });
  test("survives cycles, errors and odd values", () => {
    const a: Record<string, unknown> = { n: 1 };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(redact({ e: new Error("boom") })).toEqual({ e: { name: "Error", message: "boom" } });
    expect(redact({ f: () => 1, u: undefined, b: 10n })).toBeTruthy();
  });
  test("long strings are cut", () => {
    expect((redact({ s: "x".repeat(5000) }) as { s: string }).s.length).toBeLessThanOrEqual(1010);
  });
});

describe("redact: names that only look secret", () => {
  test("ordinary fields that contain 'pass' or 'cell' are kept, camelCase and dashed secret names are hidden", () => {
    const out = redact({ cancelled: true, cancelling: 2, passed: 5, compass: "n", pfPaymentId: "x", accessToken: "t", user_email: "e", "x-api-key": "k", cellNumber: "1", Authorization: "b", phoneNumber: "p", failed: 1 }) as Record<string, unknown>;
    expect(out).toMatchObject({ cancelled: true, cancelling: 2, passed: 5, compass: "n", pfPaymentId: "x", failed: 1 });
    for (const k of ["accessToken", "user_email", "x-api-key", "cellNumber", "Authorization", "phoneNumber"]) expect(out[k]).toBe("[hidden]");
  });
});

describe("safeRoute", () => {
  test("hides link tokens and keeps ordinary paths, and drops the query", () => {
    expect(safeRoute("/p/Abcdefghijklmnopqrstuvwxyz012345?x=1")).toBe("/p/:id");
    expect(safeRoute("/portal/Abcdefghijklmnopqrstuvwxyz012345/contracts/12345678-1234-1234-1234-123456789012")).toBe("/portal/:id/contracts/:id");
    expect(safeRoute("/acme/money")).toBe("/acme/money");
  });
});

describe("scrubText", () => {
  test("keeps ordinary ids (UUIDs) so errors can still be traced", () => {
    expect(scrubText("workspace 12345678-1234-1234-1234-123456789012 not found")).toContain("12345678-1234-1234-1234-123456789012");
  });
  test("removes emails, long tokens and bearer values from free text", () => {
    const t = scrubText("failed for thandi@example.co.za with Bearer abc.def.ghi and key tok_live_ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(t).not.toContain("thandi@example.co.za");
    expect(t).not.toContain("abc.def.ghi");
    expect(t).not.toContain("tok_live_ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(t).toContain("failed for");
  });
});

describe("formatLog", () => {
  test("is one JSON line with level, event, time and the redacted fields", () => {
    const line = formatLog("error", "payfast_itn_refused", { reason: "signature", token: "t" }, new Date("2026-11-13T10:00:00Z"));
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ level: "error", event: "payfast_itn_refused", time: "2026-11-13T10:00:00.000Z", reason: "signature", token: "[hidden]" });
  });
  test("a field cannot overwrite the level, event or time", () => {
    const o = JSON.parse(formatLog("info", "x", { level: "debug", event: "y", time: "z" }, new Date("2026-11-13T10:00:00Z")));
    expect(o).toMatchObject({ level: "info", event: "x", time: "2026-11-13T10:00:00.000Z" });
  });
});

describe("Sentry reporting (without the SDK)", () => {
  const dsn = "https://pubkey123@o4500.ingest.sentry.io/12345";
  test("reads a DSN, and refuses nonsense and non-https", () => {
    expect(parseDsn(dsn)).toEqual({ key: "pubkey123", host: "o4500.ingest.sentry.io", project: "12345" });
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("http://k@h/1")).toBeNull();
    expect(parseDsn("https://nokey.example.com/1")).toBeNull();
    expect(parseDsn("https://k@h.example.com/notanumber")).toBeNull();
  });
  test("builds an envelope with a scrubbed message and no request body, cookies or user details", () => {
    const e = buildSentryEnvelope(
      dsn,
      { error: new Error("could not notify thandi@example.co.za"), route: "/api/jobs/outbox", method: "POST", release: "abc123", env: "production" },
      new Date("2026-11-13T10:00:00Z"),
      () => "e".repeat(32),
    );
    expect(e).not.toBeNull();
    const [header, itemHeader, payload] = e!.body.split("\n").map((l) => JSON.parse(l));
    expect(header).toMatchObject({ event_id: "e".repeat(32), dsn });
    expect(itemHeader).toMatchObject({ type: "event" });
    expect(payload.exception.values[0].type).toBe("Error");
    expect(payload.exception.values[0].value).not.toContain("thandi@example.co.za");
    expect(payload.tags).toMatchObject({ route: "/api/jobs/outbox", method: "POST" });
    expect(payload.environment).toBe("production");
    expect(payload.release).toBe("abc123");
    expect(JSON.stringify(payload)).not.toMatch(/cookie|authorization|email/i);
    expect(e!.url).toBe("https://o4500.ingest.sentry.io/api/12345/envelope/");
    expect(e!.headers["X-Sentry-Auth"]).toContain("sentry_key=pubkey123");
  });
  test("no DSN means nothing is sent", () => {
    expect(buildSentryEnvelope("", { error: new Error("x"), route: "/", method: "GET" })).toBeNull();
  });
});
