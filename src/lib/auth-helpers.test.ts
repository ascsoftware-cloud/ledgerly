import { describe, expect, test } from "vitest";
import { codeSchema, emailSchema } from "@/features/auth/schema";
import { bucketFor, createRateLimiter } from "./rate-limit-core";
import { safeNext } from "./safe-next";

describe("safeNext (open-redirect guard)", () => {
  test.each([
    ["/welcome", "/welcome"],
    ["/acme-1a2b", "/acme-1a2b"],
    ["/acme-1a2b/money?tab=overdue", "/acme-1a2b/money?tab=overdue"],
    // A merchant installing from Shopify signs in and comes back here to pick their business.
    ["/auth/shopify/connect?shop=cool-store.myshopify.com", "/auth/shopify/connect?shop=cool-store.myshopify.com"],
  ])("keeps the same-site path %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  test.each([
    null,
    "",
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "welcome",
    "/auth/callback",
    "/login?next=/login",
    "/%2F%2Fevil.example",
    "/\tevil",
    "/" + "a".repeat(300),
  ])("falls back to /welcome for %j", (input) => {
    expect(safeNext(input)).toBe("/welcome");
  });

  test("uses the given fallback", () => {
    expect(safeNext("//x", "/start")).toBe("/start");
  });
});

describe("emailSchema", () => {
  test("trims and lower-cases", () => {
    expect(emailSchema.parse("  Thandi@Example.CO.ZA ")).toBe("thandi@example.co.za");
  });
  test.each(["", "not-an-email", "a@b", "a@@b.co", "x".repeat(250) + "@b.co"])("rejects %j", (v) => {
    expect(emailSchema.safeParse(v).success).toBe(false);
  });
});

describe("codeSchema", () => {
  test("accepts six digits, ignoring spaces a phone may insert", () => {
    expect(codeSchema.parse("123 456")).toBe("123456");
    expect(codeSchema.parse(" 004213 ")).toBe("004213");
  });
  test.each(["12345", "1234567", "12a456", ""])("rejects %j", (v) => {
    expect(codeSchema.safeParse(v).success).toBe(false);
  });
});

describe("rate limiter", () => {
  test("hashes the identifier: no raw email or IP is ever sent", () => {
    const bucket = bucketFor("otp-email", "Thandi@Example.co.za");
    expect(bucket).toMatch(/^otp-email:[0-9a-f]{64}$/);
    expect(bucket).not.toContain("thandi");
    expect(bucketFor("otp-email", "thandi@example.co.za")).toBe(bucket); // case-insensitive
  });

  test("asks the database and returns its answer", async () => {
    const calls: unknown[] = [];
    const limit = createRateLimiter({
      call: async (args) => {
        calls.push(args);
        return { data: false, error: null };
      },
      production: true,
    });
    expect(await limit("otp-ip", "1.2.3.4", 10, 3600)).toBe(false);
    expect(calls).toEqual([
      { p_bucket: bucketFor("otp-ip", "1.2.3.4"), max_hits: 10, window_seconds: 3600 },
    ]);
  });

  test("without the server key: allows in development, refuses in production", async () => {
    const dev = createRateLimiter({ call: null, production: false, warn: () => {} });
    const prod = createRateLimiter({ call: null, production: true, warn: () => {} });
    expect(await dev("otp-email", "a@b.co", 3, 600)).toBe(true);
    expect(await prod("otp-email", "a@b.co", 3, 600)).toBe(false);
  });

  test("a database error refuses in production rather than letting floods through", async () => {
    const limit = createRateLimiter({
      call: async () => ({ data: null, error: { message: "boom" } }),
      production: true,
      warn: () => {},
    });
    expect(await limit("otp-email", "a@b.co", 3, 600)).toBe(false);
  });
});
