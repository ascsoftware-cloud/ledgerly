import { describe, expect, test } from "vitest";
import { buildInviteEmail } from "@/server/jobs/email-template";
import { hashToken, inviteSchema, newToken, ROLE_HELP } from "./schema";

describe("invitation tokens", () => {
  test("hashToken is the same SHA-256 hex the database computes", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("a new token is 43 URL-safe characters and never repeats", () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe("inviteSchema", () => {
  test("lower-cases and trims the email", () => {
    expect(inviteSchema.parse({ email: "  Thandi@Example.CO.za ", role: "staff" })).toEqual({ email: "thandi@example.co.za", role: "staff" });
  });
  test.each(["admin", "staff", "accountant"])("%s can be invited", (role) => expect(inviteSchema.safeParse({ email: "a@b.co", role }).success).toBe(true));
  test("an owner cannot be invited", () => {
    const r = inviteSchema.safeParse({ email: "a@b.co", role: "owner" });
    expect(r.success).toBe(false);
  });
  test.each(["", "nope", "a@b", "a b@c.co"])("rejects the email %j", (email) => {
    const r = inviteSchema.safeParse({ email, role: "staff" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/email/i);
  });
  test("every invitable role has a plain-language explanation", () => {
    for (const role of ["admin", "staff", "accountant"] as const) expect(ROLE_HELP[role].length).toBeGreaterThan(20);
  });
});

describe("buildInviteEmail", () => {
  const input = { businessName: "Olga Plumbing", inviterName: "Olga", role: "staff" as const, link: "https://business.ascsoftware.co.za/invite/abc_DEF-123" };

  test("says who invited you, to what, and links to accept", () => {
    const m = buildInviteEmail(input);
    expect(m.subject).toBe("Olga invited you to Olga Plumbing on Ledgerly");
    expect(m.text).toContain(input.link);
    expect(m.text).toContain("staff");
    expect(m.html).toContain(`href="${input.link}"`);
  });
  test("escapes names typed by users", () => {
    const m = buildInviteEmail({ ...input, businessName: `<img src=x onerror=alert(1)>`, inviterName: `"><script>x</script>` });
    expect(m.html).not.toContain("<img");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;img");
  });
  test("a long or odd inviter name cannot break the subject line", () => {
    const m = buildInviteEmail({ ...input, inviterName: "Olga\r\nBcc: x@y.z" });
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});
