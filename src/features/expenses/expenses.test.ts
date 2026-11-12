import { describe, expect, test } from "vitest";
import { expenseSchema, nextOccurrence, vatFromInclusive } from "./schema";

describe("vatFromInclusive (15% VAT inside a VAT-inclusive amount)", () => {
  test.each([
    [115000, 15000],
    [1150, 150],
    [100, 13], // 13.04 → 13
    [23, 3], // 3.0 → 3
    [1, 0],
  ])("%i cents includes %i cents VAT", (amount, vat) => {
    expect(vatFromInclusive(amount)).toBe(vat);
  });

  test("halves round away from zero, like invoice lines", () => {
    // 115 × 15/115 = 15 exactly; 1035 × 15/115 = 135 exactly; 4 × 15/115 = 0.5217 → 1
    expect(vatFromInclusive(4)).toBe(1);
  });
});

describe("expenseSchema", () => {
  const base = {
    amount: "R 1 150,00",
    spentOn: "10/11/2026",
    supplier: " Engen ",
    categoryId: "",
    includesVat: "on",
    method: "card",
    description: "",
    requestId: "0b8f8a2e-3c2a-4f4a-9f6a-2b1d1c0e9a11",
  };

  test("reads South African amounts and dates, and works out the VAT", () => {
    const r = expenseSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({ amountCents: 115000, vatCents: 15000, spentOn: "2026-11-10", supplier: "Engen", categoryId: null, method: "card" });
  });

  test("no VAT when the toggle is off", () => {
    const r = expenseSchema.safeParse({ ...base, includesVat: undefined });
    expect(r.success && r.data.vatCents).toBe(0);
  });

  test.each([
    [{ amount: "" }, "Enter the amount"],
    [{ amount: "abc" }, "Enter the amount"],
    [{ amount: "0" }, "Enter the amount"],
    [{ spentOn: "13/31/2026" }, "Use a date like"],
    [{ categoryId: "not-a-uuid" }, "Choose a category"],
    [{ method: "bitcoin" }, "How did you pay"],
  ])("%j is refused with a clear message", (patch, message) => {
    const r = expenseSchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain(message);
  });

  test("a date in the future is refused", () => {
    const r = expenseSchema.safeParse({ ...base, spentOn: "01/01/2099" });
    expect(r.success).toBe(false);
  });
});

describe("nextOccurrence (mirrors SQL app.next_occurrence)", () => {
  test.each([
    ["2026-01-31", "monthly", 31, "2026-02-28"],
    ["2026-02-28", "monthly", 31, "2026-03-31"],
    ["2028-01-31", "monthly", 31, "2028-02-29"],
    ["2026-12-15", "monthly", 15, "2027-01-15"],
    ["2026-11-10", "weekly", 10, "2026-11-17"],
    ["2028-02-29", "yearly", 29, "2029-02-28"],
  ] as const)("%s %s (day %i) → %s", (from, cadence, anchor, expected) => {
    expect(nextOccurrence(from, cadence, anchor)).toBe(expected);
  });
});
