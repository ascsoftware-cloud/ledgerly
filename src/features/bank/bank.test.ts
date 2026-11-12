import { describe, expect, test } from "vitest";
import {
  detectDuplicates,
  findTable,
  fingerprintKeys,
  guessBankMapping,
  parseBankAmount,
  parseBankDate,
  suggestMatch,
  toBankLines,
} from "./parse";

describe("parseBankDate (formats SA bank exports use)", () => {
  test.each([
    ["31/01/2026", "2026-01-31"],
    ["1/2/2026", "2026-02-01"],
    ["2026-01-31", "2026-01-31"],
    ["2026/01/31", "2026-01-31"],
    ["20260131", "2026-01-31"],
    ["31 Jan 2026", "2026-01-31"],
    ["31-Jan-2026", "2026-01-31"],
    ["5 September 2026", "2026-09-05"],
  ])("%s → %s", (input, expected) => {
    expect(parseBankDate(input)).toBe(expected);
  });

  test.each(["", "BROUGHT FORWARD", "31/02/2026", "2026-13-01", "12345"])("%j is not a date", (input) => {
    expect(parseBankDate(input)).toBeNull();
  });
});

describe("parseBankAmount (signed cents; money in is positive)", () => {
  test.each([
    ["R 1 234,56", 123456],
    ["1,234.56", 123456],
    ["-450.00", -45000],
    ["450.00 Dr", -45000],
    ["450.00Cr", 45000],
    ["(450.00)", -45000],
    ["-R 1 000,00", -100000],
  ])("%s → %i", (input, expected) => {
    expect(parseBankAmount(input)).toBe(expected);
  });

  test.each(["", "abc", "12.345"])("%j is not an amount", (input) => {
    expect(parseBankAmount(input)).toBeNull();
  });
});

const FNB = [
  ["ACCOUNT TRANSACTION HISTORY"],
  ["Account", "62000000000"],
  [],
  ["Date", "Amount", "Balance", "Description"],
  ["01/11/2026", "-450.00", "9550.00", "POS PURCHASE ENGEN RIVONIA"],
  ["03/11/2026", "2300.00", "11850.00", "MAGTAPE CREDIT THANDI INV-0001"],
  ["03/11/2026", "2300.00", "14150.00", "MAGTAPE CREDIT THANDI INV-0001"],
  ["", "", "", "CLOSING BALANCE"],
];

describe("findTable and guessBankMapping", () => {
  test("skips the bank's preamble and finds the header row", () => {
    const t = findTable(FNB);
    expect(t.headers).toEqual(["Date", "Amount", "Balance", "Description"]);
    expect(t.firstDataRow).toBe(4);
  });

  test("guesses date, amount and description, and never uses the balance as the amount", () => {
    expect(guessBankMapping(["Date", "Amount", "Balance", "Description"])).toEqual({ date: 0, amount: 1, debit: null, credit: null, description: [3] });
  });

  test("handles separate debit and credit columns", () => {
    expect(guessBankMapping(["Transaction Date", "Description", "Reference", "Debit", "Credit", "Balance"])).toEqual({
      date: 0,
      amount: null,
      debit: 3,
      credit: 4,
      description: [1, 2],
    });
  });

  test("a file with no header row gets numbered columns guessed from the content", () => {
    const t = findTable([[""], ["20261101", "POS ENGEN", "-450.00", "9550.00"], ["20261102", "SALARY", "10000.00", "19550.00"]]);
    expect(t.headers).toEqual(["Column 1", "Column 2", "Column 3", "Column 4"]);
    expect(t.firstDataRow).toBe(1);
    expect(t.mapping).toEqual({ date: 0, amount: 2, debit: null, credit: null, description: [1] });
  });
});

describe("toBankLines", () => {
  test("reads each transaction and counts what it skipped, with the row number", () => {
    const t = findTable(FNB);
    const r = toBankLines(FNB.slice(t.firstDataRow), guessBankMapping(t.headers), t.firstDataRow);
    expect(r.lines).toEqual([
      { postedOn: "2026-11-01", amountCents: -45000, description: "POS PURCHASE ENGEN RIVONIA" },
      { postedOn: "2026-11-03", amountCents: 230000, description: "MAGTAPE CREDIT THANDI INV-0001" },
      { postedOn: "2026-11-03", amountCents: 230000, description: "MAGTAPE CREDIT THANDI INV-0001" },
    ]);
    expect(r.skipped).toEqual([{ row: 8, reason: "summary" }]);
  });

  test("debit and credit columns become one signed amount", () => {
    const rows = [["31/10/2026", "Bank fees", "", "65.00", "", "100.00"], ["31/10/2026", "Deposit", "Ref 9", "", "500.00", "600.00"]];
    const m = { date: 0, amount: null, debit: 3, credit: 4, description: [1, 2] };
    expect(toBankLines(rows, m, 1).lines).toEqual([
      { postedOn: "2026-10-31", amountCents: -6500, description: "Bank fees" },
      { postedOn: "2026-10-31", amountCents: 50000, description: "Deposit Ref 9" },
    ]);
  });

  test("Nedbank's brought-forward row is skipped, not imported", () => {
    const r = toBankLines([["2026-11-01", "BROUGHT FORWARD", "1000.00"]], { date: 0, amount: 2, debit: null, credit: null, description: [1] }, 2);
    expect(r.lines).toEqual([]);
    expect(r.skipped).toEqual([{ row: 3, reason: "summary" }]);
  });

  test("a row without a date or amount is reported, never silently dropped", () => {
    const r = toBankLines([["", "Something", "10.00"], ["01/11/2026", "Something", "nope"]], { date: 0, amount: 2, debit: null, credit: null, description: [1] }, 1);
    expect(r.skipped).toEqual([
      { row: 2, reason: "no date" },
      { row: 3, reason: "no amount" },
    ]);
  });
});

describe("fingerprints and duplicates", () => {
  const a = { postedOn: "2026-11-03", amountCents: 230000, description: "MAGTAPE  credit thandi" };
  const b = { postedOn: "2026-11-03", amountCents: 230000, description: "magtape credit THANDI" };

  test("two identical lines in one file are both kept (occurrence 0 and 1)", () => {
    const keys = fingerprintKeys([a, b]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toBe("2026-11-03|230000|magtape credit thandi|0");
    expect(keys[1]).toBe("2026-11-03|230000|magtape credit thandi|1");
  });

  test("re-importing the same file adds nothing", () => {
    const keys = fingerprintKeys([a, b]);
    expect(detectDuplicates(keys, new Set(keys))).toEqual({ fresh: [], duplicates: [0, 1] });
  });

  test("a longer statement that overlaps the last one adds only the new lines", () => {
    const first = fingerprintKeys([a]);
    const second = fingerprintKeys([a, b, { ...a, postedOn: "2026-11-04" }]);
    expect(detectDuplicates(second, new Set(first))).toEqual({ fresh: [1, 2], duplicates: [0] });
  });
});

describe("suggestMatch (money in → open invoice)", () => {
  const invoices = [
    { id: "i1", number: "INV-0001", owedCents: 230000 },
    { id: "i2", number: "INV-0002", owedCents: 99000 },
    { id: "i3", number: "INV-0003", owedCents: 99000 },
  ];
  test("the invoice number in the description wins, even written differently", () => {
    expect(suggestMatch({ amountCents: 100000, description: "EFT THANDI inv0001" }, invoices)).toEqual({ id: "i1", reason: "number" });
  });
  test("otherwise an exact amount, if only one invoice owes it", () => {
    expect(suggestMatch({ amountCents: 230000, description: "EFT" }, invoices)).toEqual({ id: "i1", reason: "amount" });
  });
  test("two invoices owing the same amount is ambiguous: no guess", () => {
    expect(suggestMatch({ amountCents: 99000, description: "EFT" }, invoices)).toBeNull();
  });
  test("money out is never matched to an invoice", () => {
    expect(suggestMatch({ amountCents: -230000, description: "INV-0001" }, invoices)).toBeNull();
  });
  test("a payment larger than what is owed is not suggested", () => {
    expect(suggestMatch({ amountCents: 500000, description: "INV-0002" }, invoices)).toBeNull();
  });
});

describe("reading a semicolon statement with a title line", () => {
  test("the delimiter is found past the title", async () => {
    const { parseCsv } = await import("@/features/clients/csv");
    const { headers, rows } = parseCsv("Statement for account 123\nDate;Description;Amount\n01/11/2026;Fees;-65,00\n");
    expect([headers, ...rows]).toEqual([["Statement for account 123"], ["Date", "Description", "Amount"], ["01/11/2026", "Fees", "-65,00"]]);
  });
});
