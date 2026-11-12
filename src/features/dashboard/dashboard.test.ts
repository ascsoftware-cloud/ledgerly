import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { pickTabs } from "@/components/shell/nav";
import { QUEST, questHref } from "@/features/quest/catalogue";
import { getEnabledNav } from "./nav";
import { greeting } from "./greeting";

describe("getEnabledNav", () => {
  test("essentials only: Home, Money, Clients, More", () => {
    expect(getEnabledNav("acme-1a2b", ["invoices", "clients"]).map((i) => [i.label, i.href])).toEqual([
      ["Home", "/acme-1a2b"],
      ["Money", "/acme-1a2b/money"],
      ["Clients", "/acme-1a2b/clients"],
      ["More", "/acme-1a2b/more"],
    ]);
  });

  test("projects or bookings switch on Work; inventory switches on Stock", () => {
    const labels = getEnabledNav("x-1a2b", ["invoices", "clients", "bookings", "inventory"]).map(
      (i) => i.label,
    );
    expect(labels).toEqual(["Home", "Money", "Clients", "Work", "Stock", "More"]);
  });

  test("expenses alone still show Money", () => {
    expect(getEnabledNav("x-1a2b", ["expenses"]).map((i) => i.label)).toContain("Money");
  });

  test("icons are names, so the list can cross from server to browser", () => {
    for (const item of getEnabledNav("x-1a2b", ["invoices", "clients", "projects", "inventory"])) {
      expect(typeof item.icon).toBe("string");
    }
  });
});

describe("pickTabs (phone bar holds five)", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, href: `/${i}` }));
  test("five or fewer: all of them", () => {
    expect(pickTabs(mk(4)).map((i) => i.key)).toEqual(["k0", "k1", "k2", "k3"]);
  });
  test("more than five: first four plus the last (More)", () => {
    expect(pickTabs(mk(6)).map((i) => i.key)).toEqual(["k0", "k1", "k2", "k3", "k5"]);
  });
});

describe("quest catalogue", () => {
  test("has copy and a link for every step the database can create", () => {
    const sql = readFileSync("supabase/migrations/0002_provisioning.sql", "utf8");
    const list = /key text not null check \(key in \(([^)]*)\)\)/.exec(sql)?.[1] ?? "";
    const dbKeys = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(dbKeys.length).toBeGreaterThan(5);
    expect(Object.keys(QUEST).sort()).toEqual(dbKeys);
  });

  test("links stay inside the workspace", () => {
    for (const key of Object.keys(QUEST) as (keyof typeof QUEST)[]) {
      expect(questHref(key, "acme-1a2b")).toMatch(/^\/acme-1a2b\//);
    }
  });
});

describe("greeting (South African time)", () => {
  test.each([
    ["2026-03-02T04:30:00Z", "Good morning"], // 06:30 SAST
    ["2026-03-02T09:59:00Z", "Good morning"], // 11:59
    ["2026-03-02T10:00:00Z", "Good afternoon"], // 12:00
    ["2026-03-02T15:00:00Z", "Good evening"], // 17:00
    ["2026-03-02T22:30:00Z", "Good evening"], // 00:30 next day
  ])("%s → %s", (iso, expected) => {
    expect(greeting(new Date(iso))).toBe(expected);
  });
});
