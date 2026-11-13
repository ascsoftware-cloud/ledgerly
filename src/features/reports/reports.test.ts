import { describe, expect, test } from "vitest";
import { centsToDecimal, csvFor, resolvePeriod, tableFor, toCsv, type ReportData } from "./schema";

describe("resolvePeriod (SAST dates, today = 2026-11-13)", () => {
  const today = "2026-11-13";
  test.each([
    ["this-month", "2026-11-01", "2026-11-30"],
    ["last-month", "2026-10-01", "2026-10-31"],
    ["this-quarter", "2026-10-01", "2026-12-31"],
    ["last-quarter", "2026-07-01", "2026-09-30"],
    ["tax-year", "2026-03-01", "2027-02-28"],
    ["last-tax-year", "2025-03-01", "2026-02-28"],
  ])("%s → %s to %s", (key, from, to) => {
    expect(resolvePeriod({ period: key }, today)).toMatchObject({ key, from, to });
  });

  test("the tax year starts in March, even in January", () => {
    expect(resolvePeriod({ period: "tax-year" }, "2027-01-15")).toMatchObject({ from: "2026-03-01", to: "2027-02-28" });
  });
  test("a leap February is 29 days", () => {
    expect(resolvePeriod({ period: "last-month" }, "2028-03-10")).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
    expect(resolvePeriod({ period: "tax-year" }, "2027-06-01")).toMatchObject({ to: "2028-02-29" });
  });
  test("the first quarter wraps the year", () => {
    expect(resolvePeriod({ period: "last-quarter" }, "2027-02-02")).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
  });
  test("a custom range reads South African dates or ISO", () => {
    expect(resolvePeriod({ period: "custom", from: "01/10/2026", to: "2026-10-31" }, today)).toMatchObject({ key: "custom", from: "2026-10-01", to: "2026-10-31" });
  });
  test.each([
    [{ period: "custom", from: "31/10/2026", to: "01/10/2026" }],
    [{ period: "custom", from: "nonsense", to: "2026-10-31" }],
    [{ period: "custom", from: "2010-01-01", to: "2026-10-31" }],
    [{ period: "nope" }],
    [{}],
  ])("junk %j falls back to this month", (params) => {
    expect(resolvePeriod(params, today)).toMatchObject({ key: "this-month", from: "2026-11-01", to: "2026-11-30" });
  });
  test("has a readable label", () => {
    expect(resolvePeriod({ period: "last-month" }, today).label).toBe("October 2026");
    expect(resolvePeriod({ period: "custom", from: "2026-10-01", to: "2026-10-15" }, today).label).toBe("1 Oct 2026 to 15 Oct 2026");
  });
});

describe("centsToDecimal", () => {
  test.each([
    [0, "0.00"],
    [5, "0.05"],
    [123456, "1234.56"],
    [-1230, "-12.30"],
    [100000000, "1000000.00"],
  ])("%i → %s", (c, want) => expect(centsToDecimal(c)).toBe(want));
});

describe("toCsv", () => {
  test("quotes commas, quotes and line breaks", () => {
    expect(toCsv([["a,b", 'say "hi"', "two\nlines", 5]])).toBe('"a,b","say ""hi""","two\nlines",5');
  });
  test("neutralises spreadsheet formulas in text cells, never in numbers", () => {
    const csv = toCsv([["=HYPERLINK(\"x\")", "+1", "-2", "@SUM(1)", "\tx", "normal", -45.5]]);
    expect(csv).toBe(`"'=HYPERLINK(""x"")",'+1,'-2,'@SUM(1),'\tx,normal,-45.5`);
  });
  test("rows are separated by CRLF", () => {
    expect(toCsv([["a"], ["b"]])).toBe("a\r\nb");
  });
});

describe("tableFor", () => {
  const pnl: ReportData = {
    kind: "pnl",
    data: {
      from: "2026-10-01",
      to: "2026-10-31",
      income_cents: 250000,
      credit_cents: 50000,
      net_income_cents: 200000,
      expenses_cents: 45000,
      profit_cents: 155000,
      invoice_count: 2,
      expenses_by_category: [
        { category: "Rent", cents: 30000 },
        { category: "Fuel and travel", cents: 10000 },
      ],
    },
  };
  test("profit and loss lists income, credit notes, each expense and the profit, in rand", () => {
    const t = tableFor(pnl, "October 2026");
    expect(t.title).toBe("Profit and loss, October 2026");
    expect(t.rows).toEqual([
      ["Invoiced (excluding VAT)", "2500.00"],
      ["Less credit notes", "-500.00"],
      ["Net income", "2000.00"],
      ["Expenses: Rent", "-300.00"],
      ["Expenses: Fuel and travel", "-100.00"],
      ["Total expenses", "-450.00"],
      ["Profit", "1550.00"],
    ]);
  });

  test("a loss is negative", () => {
    const t = tableFor({ ...pnl, data: { ...pnl.data, profit_cents: -2500 } }, "x");
    expect(t.rows.at(-1)).toEqual(["Profit", "-25.00"]);
  });

  test("aged debtors list each invoice and the totals by age", () => {
    const t = tableFor(
      {
        kind: "aged",
        data: {
          as_of: "2026-11-10",
          totals: { current: 10000, d1_30: 202500, d31_60: 92000, d61_90: 0, over_90: 5000, total: 309500 },
          rows: [{ contact: "Thandi", number: "INV-3", due_date: "2026-09-29", days_overdue: 42, balance_cents: 92000, bucket: "d31_60" }],
          by_client: [{ contact: "Thandi", total_cents: 92000 }],
        },
      },
      "10 Nov 2026",
    );
    expect(t.headers).toEqual(["Client", "Invoice", "Due", "Days overdue", "Owed"]);
    expect(t.rows[0]).toEqual(["Thandi", "INV-3", "2026-09-29", "42", "920.00"]);
    expect(t.rows.at(-1)).toEqual(["Total owed", "", "", "", "3095.00"]);
  });

  test("the forecast has one row per week with in, out, net and running total", () => {
    const t = tableFor(
      {
        kind: "cashflow",
        data: { today: "2026-11-10", total_in_cents: 10000, total_out_cents: 1000, weeks: [{ start: "2026-11-10", in_cents: 10000, out_cents: 1000, net_cents: 9000, running_cents: 9000 }] },
      },
      "",
    );
    expect(t.headers).toEqual(["Week starting", "Money in", "Money out", "Net", "Running total"]);
    expect(t.rows[0]).toEqual(["2026-11-10", "100.00", "-10.00", "90.00", "90.00"]);
  });

  test("VAT shows output, input and what is payable", () => {
    const t = tableFor(
      { kind: "vat", data: { from: "2026-10-01", to: "2026-10-31", vat_registered: true, output_vat_cents: 22500, input_vat_cents: 2250, net_vat_cents: 20250, standard_rated_cents: 150000, zero_rated_cents: 50000 } },
      "October 2026",
    );
    expect(t.rows).toContainEqual(["VAT payable to SARS (output less input)", "202.50"]);
    expect(t.rows).toContainEqual(["Standard-rated sales (excluding VAT)", "1500.00"]);
  });
});

describe("csvFor", () => {
  test("keeps losses as numbers but neutralises a client named like a formula", () => {
    const csv = csvFor({ title: "Aged debtors", headers: ["Client", "Owed"], rows: [["=cmd|' /C calc'!A0", "-25.00"], ["Thandi", "920.00"]] });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Aged debtors");
    expect(lines[2]).toBe(`'=cmd|' /C calc'!A0,-25`);
    expect(lines[3]).toBe("Thandi,920");
  });
});
