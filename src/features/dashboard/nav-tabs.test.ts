import { describe, expect, test } from "vitest";
import { pickTabs } from "@/components/shell/nav";
import { NAV_ICONS } from "@/components/shell/icons";
import { getEnabledNav } from "./nav";

describe("Accounting, Courier and Shopify tabs", () => {
  test("off unless the workspace shows them", () => {
    expect(getEnabledNav("acme-1a2b", ["invoices", "clients"]).map((i) => i.key)).toEqual([
      "home",
      "money",
      "clients",
      "more",
    ]);
  });
  test("sit after the module tabs and before More, in a fixed order", () => {
    const nav = getEnabledNav("acme-1a2b", ["invoices", "clients", "inventory"], {
      shopify: true,
      accounting: true,
      courier: true,
    });
    expect(nav.map((i) => [i.label, i.href])).toEqual([
      ["Home", "/acme-1a2b"],
      ["Money", "/acme-1a2b/money"],
      ["Clients", "/acme-1a2b/clients"],
      ["Stock", "/acme-1a2b/stock"],
      ["Accounting", "/acme-1a2b/accounting"],
      ["Courier", "/acme-1a2b/courier"],
      ["Shopify", "/acme-1a2b/shop"],
      ["More", "/acme-1a2b/more"],
    ]);
  });
  test("each tab can be on alone", () => {
    expect(getEnabledNav("x-1a2b", [], { courier: true }).map((i) => i.key)).toEqual([
      "home",
      "courier",
      "more",
    ]);
  });
  test("every icon exists", () => {
    for (const item of getEnabledNav("x-1a2b", ["invoices"], {
      shopify: true,
      accounting: true,
      courier: true,
    })) {
      expect(NAV_ICONS[item.icon]).toBeTruthy();
    }
  });
  test("phones keep More as the fifth tab, so hidden extras stay reachable", () => {
    const tabs = pickTabs(
      getEnabledNav("x-1a2b", ["invoices", "clients"], {
        shopify: true,
        accounting: true,
        courier: true,
      }),
    );
    expect(tabs.map((t) => t.key)).toEqual(["home", "money", "clients", "accounting", "more"]);
  });
});
