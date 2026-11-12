import { describe, expect, test } from "vitest";
import { buildCsp, securityHeaders } from "./csp";

const prod = { supabaseUrl: "https://abc123.supabase.co", dev: false };

function directive(csp: string, name: string): string {
  const found = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
  return found ?? "";
}

describe("buildCsp", () => {
  test("defaults to same-origin only", () => {
    expect(directive(buildCsp(prod), "default-src")).toBe("default-src 'self'");
  });

  test("production scripts cannot use eval", () => {
    expect(directive(buildCsp(prod), "script-src")).not.toContain("'unsafe-eval'");
  });

  test("development allows eval, which React's dev tooling needs", () => {
    expect(directive(buildCsp({ ...prod, dev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  test("the page cannot be framed, and plugins and base-tag hijacks are blocked", () => {
    const csp = buildCsp(prod);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  test("the browser may talk to Supabase over https and websockets, and nowhere else", () => {
    expect(directive(buildCsp(prod), "connect-src")).toBe(
      "connect-src 'self' https://abc123.supabase.co wss://abc123.supabase.co",
    );
  });

  test("without a Supabase URL, connections are same-origin only", () => {
    expect(directive(buildCsp({ supabaseUrl: "", dev: false }), "connect-src")).toBe(
      "connect-src 'self'",
    );
  });

  test("a malformed Supabase URL is ignored rather than injected into the policy", () => {
    const csp = buildCsp({ supabaseUrl: "https://x.co; script-src *", dev: false });
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
    expect(csp).not.toContain("script-src *");
  });

  test("is a single header line", () => {
    expect(buildCsp(prod)).not.toMatch(/[\r\n]/);
  });
});

describe("securityHeaders", () => {
  test("sets the six headers every response must carry", () => {
    const keys = securityHeaders(prod).map((h) => h.key);
    expect(keys).toEqual([
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "X-Frame-Options",
      "Permissions-Policy",
    ]);
  });

  test("uses the strict values", () => {
    const h = Object.fromEntries(securityHeaders(prod).map(({ key, value }) => [key, value]));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Strict-Transport-Security"]).toContain("max-age=63072000");
  });
});
