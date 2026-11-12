import { describe, expect, test } from "vitest";
import { formatMoney } from "@/lib/money";
import { formatShopMoney, salesByDay, statusWords } from "./format";

describe("shop formatting", () => {
  test("money in the store's currency", () => {
    expect(formatShopMoney(1234.5, "ZAR")).toBe(formatMoney(123450));
    expect(formatShopMoney(10, "USD")).toContain("10");
  });
  test("status words", () => {
    expect(statusWords("PARTIALLY_PAID")).toBe("Partially paid");
    expect(statusWords(null)).toBe("—");
  });
  test("sales by day are in SAST and leave out cancelled orders", () => {
    const now = new Date("2026-11-12T10:00:00Z");
    const days = salesByDay(
      [
        { shop_created_at: "2026-11-11T22:30:00Z", cancelled_at: null, total: 100.1 }, // 00:30 on the 12th in SAST
        { shop_created_at: "2026-11-12T08:00:00Z", cancelled_at: null, total: 50.2 },
        {
          shop_created_at: "2026-11-12T09:00:00Z",
          cancelled_at: "2026-11-12T09:30:00Z",
          total: 999,
        },
        { shop_created_at: "2026-10-01T09:00:00Z", cancelled_at: null, total: 5 },
      ],
      3,
      now,
    );
    expect(days).toEqual([
      { day: "2026-11-10", total: 0, count: 0 },
      { day: "2026-11-11", total: 0, count: 0 },
      { day: "2026-11-12", total: 150.3, count: 2 },
    ]);
  });
});
