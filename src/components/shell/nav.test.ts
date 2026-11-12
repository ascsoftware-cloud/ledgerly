import { describe, expect, test } from "vitest";
import { isActive } from "./nav";

const home = { href: "/acme" };
const money = { href: "/acme/money" };
const clients = { href: "/acme/clients" };
const items = [home, money, clients];

describe("isActive", () => {
  test("exact match is active", () => {
    expect(isActive("/acme/money", money, items)).toBe(true);
  });
  test("a page beneath the item keeps it active", () => {
    expect(isActive("/acme/money/invoices/42", money, items)).toBe(true);
  });
  test("home is not active when a deeper item matches", () => {
    expect(isActive("/acme/money", home, items)).toBe(false);
  });
  test("home is active on its own page and on pages no other item owns", () => {
    expect(isActive("/acme", home, items)).toBe(true);
    expect(isActive("/acme/settings", home, items)).toBe(true);
  });
  test("a shared prefix is not a match", () => {
    expect(isActive("/acme/moneybags", money, items)).toBe(false);
  });
});
