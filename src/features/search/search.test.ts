import { describe, expect, test } from "vitest";
import { hrefForResult, isTypingTarget, nextKey, SHORTCUT_HELP, searchSchema } from "./keys";

const nav = [
  { key: "home", href: "/acme" },
  { key: "money", href: "/acme/money" },
  { key: "clients", href: "/acme/clients" },
  { key: "work", href: "/acme/work" },
  { key: "stock", href: "/acme/stock" },
  { key: "more", href: "/acme/more" },
];
const ctx = { slug: "acme", nav, canCreate: true };

describe("nextKey: g then a letter goes somewhere", () => {
  test("g waits for the next key", () => {
    expect(nextKey(null, "g", ctx)).toEqual({ pending: "g" });
  });
  test.each([
    ["h", "/acme"],
    ["m", "/acme/money"],
    ["c", "/acme/clients"],
    ["w", "/acme/work"],
    ["s", "/acme/stock"],
  ])("g then %s goes to %s", (k, href) => {
    expect(nextKey("g", k, ctx)).toEqual({ go: href });
  });
  test("a place this business has switched off is simply not a shortcut", () => {
    expect(nextKey("g", "s", { ...ctx, nav: nav.filter((n) => n.key !== "stock") })).toEqual({});
  });
  test("any other second key cancels", () => {
    expect(nextKey("g", "x", ctx)).toEqual({});
  });
});

describe("nextKey: n then a letter creates", () => {
  test.each([
    ["i", "/acme/money/new?kind=invoice"],
    ["c", "/acme/clients/new"],
    ["t", "/acme/work/tasks/new"],
    ["e", "/acme/money/expenses/new"],
  ])("n then %s goes to %s", (k, href) => {
    expect(nextKey("n", k, ctx)).toEqual({ go: href });
  });
  test("read-only roles cannot create, so n does nothing", () => {
    expect(nextKey(null, "n", { ...ctx, canCreate: false })).toEqual({});
    expect(nextKey("n", "i", { ...ctx, canCreate: false })).toEqual({});
  });
});

describe("nextKey: the rest", () => {
  test("? opens help", () => {
    expect(nextKey(null, "?", ctx)).toEqual({ help: true });
  });
  test("an unrelated key does nothing, and a stray letter after nothing does nothing", () => {
    expect(nextKey(null, "h", ctx)).toEqual({});
    expect(nextKey(null, "Enter", ctx)).toEqual({});
  });
  test("capital letters count (caps lock)", () => {
    expect(nextKey("G", "H", ctx)).toEqual({ go: "/acme" });
    expect(nextKey(null, "G", ctx)).toEqual({ pending: "g" });
  });
});

describe("isTypingTarget", () => {
  test.each([["INPUT", true], ["TEXTAREA", true], ["SELECT", true], ["DIV", false], ["BUTTON", false]])("%s -> %s", (tag, yes) => {
    expect(isTypingTarget({ tagName: tag, isContentEditable: false })).toBe(yes);
  });
  test("editable regions count", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("hrefForResult", () => {
  test.each([
    ["client", "/acme/clients/ID"],
    ["invoice", "/acme/money/ID"],
    ["quote", "/acme/money/ID"],
    ["task", "/acme/work/tasks/ID"],
    ["project", "/acme/work/projects/ID"],
    ["product", "/acme/stock/ID"],
  ])("%s opens %s", (kind, href) => {
    expect(hrefForResult("acme", kind, "ID")).toBe(href);
  });
  test("an unknown kind has no link", () => {
    expect(hrefForResult("acme", "mystery", "ID")).toBeNull();
  });
});

describe("searchSchema", () => {
  test("trims and caps what is searched", () => {
    expect(searchSchema.parse("  tile  ")).toBe("tile");
    expect(searchSchema.safeParse("x".repeat(61)).success).toBe(false);
    expect(searchSchema.safeParse(42).success).toBe(false);
  });
});

test("the help list covers every shortcut", () => {
  const keys = SHORTCUT_HELP.map((s) => s.keys);
  expect(keys).toContain("Ctrl K");
  expect(keys).toContain("g then h");
  expect(keys).toContain("n then i");
  expect(keys).toContain("?");
});
