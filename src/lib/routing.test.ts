import { describe, expect, test } from "vitest";
import { classifyPath } from "./routing";

describe("classifyPath", () => {
  test.each([
    ["/", "app"],
    ["/login", "app"],
    ["/auth/confirm", "app"],
    ["/welcome", "app"],
    ["/invite/abc_DEF-123", "app"],
    ["/portal/abc_DEF-123", "app"],
    ["/book/thandi-1a2b", "app"],
    ["/book/thandi-1a2b/abc.ics", "app"],
    ["/thandi-1a2b", "workspace"],
    ["/thandi-1a2b/money", "workspace"],
    ["/Not_A_Workspace!", "not-found"],
    ["/robots.txt", "not-found"],
    ["/ab", "not-found"],
    ["/-bad-", "not-found"],
    ["/" + "a".repeat(41), "not-found"],
  ] as const)("%s → %s", (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });
});
