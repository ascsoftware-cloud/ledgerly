import { describe, expect, test } from "vitest";
import { calcLine, calcTotals, formatMoney, parseAmount, type LineInput } from "./money";

const nbsp = (s: string) => s.replace(/ /g, " ");

describe("parseAmount", () => {
  test.each([
    ["R 1 234,56", 123456],
    ["R 1 234,56", 123456],
    ["1,234.56", 123456],
    ["1.234,56", 123456],
    ["1234", 123400],
    ["12,5", 1250],
    ["12.5", 1250],
    ["1,234", 123400],
    ["1 234 567", 123456700],
    ["-50", -5000],
    ["R0,05", 5],
    ["  99.90 ", 9990],
  ])("%j → %i cents", (input, cents) => {
    expect(parseAmount(input)).toBe(cents);
  });

  test.each(["abc", "", "   ", "12,34,56", "1.2.3", "12.345", "R", "1e5", "--5", "5-"])(
    "%j is rejected",
    (input) => {
      expect(parseAmount(input)).toBeNull();
    },
  );
});

describe("formatMoney", () => {
  test("groups thousands with spaces and uses a decimal comma", () => {
    expect(nbsp(formatMoney(123456))).toBe("R 1 234,56");
  });
  test("pads cents", () => {
    expect(nbsp(formatMoney(5))).toBe("R 0,05");
    expect(nbsp(formatMoney(100000000))).toBe("R 1 000 000,00");
  });
  test("puts the minus sign before the R", () => {
    expect(nbsp(formatMoney(-123456))).toBe("-R 1 234,56");
  });
  test("round-trips through parseAmount", () => {
    expect(parseAmount(formatMoney(987654321))).toBe(987654321);
  });
});

describe("calcLine", () => {
  test("adds 15% VAT on the net and rounds half-up", () => {
    expect(calcLine({ quantity: 3, unitCents: 3333, discountPct: 0, vatRate: 15 })).toEqual({
      netCents: 9999,
      vatCents: 1500,
      grossCents: 11499,
    });
  });
  test("zero-rated line has no VAT", () => {
    expect(calcLine({ quantity: 2, unitCents: 5000, discountPct: 0, vatRate: 0 })).toEqual({
      netCents: 10000,
      vatCents: 0,
      grossCents: 10000,
    });
  });
  test("fractional quantity and discount round to whole cents", () => {
    // 0.5 × R33,33 = 1666.5c → less 12.5% = 1458.1875c → 1458c; VAT 218.7c → 219c
    expect(calcLine({ quantity: 0.5, unitCents: 3333, discountPct: 12.5, vatRate: 15 })).toEqual({
      netCents: 1458,
      vatCents: 219,
      grossCents: 1677,
    });
  });
  test("exact half rounds up, without float drift", () => {
    // 1.005 × 1000c = 1005c exactly in decimal, 1004.9999… in binary floats
    expect(calcLine({ quantity: 1.005, unitCents: 1000, discountPct: 0, vatRate: 0 }).netCents).toBe(1005);
    // 0.5 × 1c = 0.5c → 1c
    expect(calcLine({ quantity: 0.5, unitCents: 1, discountPct: 0, vatRate: 0 }).netCents).toBe(1);
  });
  test("100% discount gives zero", () => {
    expect(calcLine({ quantity: 4, unitCents: 2500, discountPct: 100, vatRate: 15 }).grossCents).toBe(0);
  });
});

describe("calcTotals", () => {
  const lines: LineInput[] = [
    { quantity: 3, unitCents: 3333, discountPct: 0, vatRate: 15 },
    { quantity: 1, unitCents: 999, discountPct: 10, vatRate: 15 },
    { quantity: 7, unitCents: 143, discountPct: 0, vatRate: 0 },
  ];

  test("total equals the sum of the line grosses", () => {
    const t = calcTotals(lines);
    const sum = lines.map(calcLine).reduce((a, l) => a + l.grossCents, 0);
    expect(t.totalCents).toBe(sum);
    expect(t.subtotalCents + t.vatCents).toBe(t.totalCents);
  });

  test("no deposit means the whole total is the balance", () => {
    const t = calcTotals(lines);
    expect(t.depositCents).toBe(0);
    expect(t.balanceCents).toBe(t.totalCents);
  });

  test("50% deposit on an odd total still adds up", () => {
    const odd: LineInput[] = [{ quantity: 1, unitCents: 10001, discountPct: 0, vatRate: 0 }];
    const t = calcTotals(odd, { type: "pct", value: 50 });
    expect(t.depositCents).toBe(5001);
    expect(t.depositCents + t.balanceCents).toBe(t.totalCents);
  });

  test("fixed deposit larger than the total is capped", () => {
    const t = calcTotals(lines, { type: "amount", value: 99999999 });
    expect(t.depositCents).toBe(t.totalCents);
    expect(t.balanceCents).toBe(0);
  });

  test("empty document totals zero", () => {
    expect(calcTotals([])).toEqual({
      subtotalCents: 0,
      vatCents: 0,
      totalCents: 0,
      depositCents: 0,
      balanceCents: 0,
    });
  });
});
