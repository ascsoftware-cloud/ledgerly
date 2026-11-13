import { z } from "zod";
import { formatDate, parseDateZA } from "@/lib/dates";

const cents = z.coerce.number();

export const pnlSchema = z.object({
  from: z.string(),
  to: z.string(),
  income_cents: cents,
  credit_cents: cents,
  net_income_cents: cents,
  expenses_cents: cents,
  profit_cents: cents,
  invoice_count: cents,
  expenses_by_category: z.array(z.object({ category: z.string(), cents })),
});
export const vatSchema = z.object({
  from: z.string(),
  to: z.string(),
  vat_registered: z.boolean(),
  output_vat_cents: cents,
  input_vat_cents: cents,
  net_vat_cents: cents,
  standard_rated_cents: cents,
  zero_rated_cents: cents,
});
export const agedSchema = z.object({
  as_of: z.string(),
  totals: z.object({ current: cents, d1_30: cents, d31_60: cents, d61_90: cents, over_90: cents, total: cents }),
  rows: z.array(z.object({ contact: z.string(), number: z.string(), due_date: z.string(), days_overdue: cents, balance_cents: cents, bucket: z.string() })),
  by_client: z.array(z.object({ contact: z.string(), total_cents: cents })),
});
export const cashSchema = z.object({
  today: z.string(),
  total_in_cents: cents,
  total_out_cents: cents,
  weeks: z.array(z.object({ start: z.string(), in_cents: cents, out_cents: cents, net_cents: cents, running_cents: cents })),
});

export type ReportData =
  | { kind: "pnl"; data: z.infer<typeof pnlSchema> }
  | { kind: "vat"; data: z.infer<typeof vatSchema> }
  | { kind: "aged"; data: z.infer<typeof agedSchema> }
  | { kind: "cashflow"; data: z.infer<typeof cashSchema> };
export type ReportKind = ReportData["kind"];

export const REPORT_TABS: { key: ReportKind; label: string }[] = [
  { key: "pnl", label: "Profit and loss" },
  { key: "cashflow", label: "Cash flow" },
  { key: "aged", label: "Aged debtors" },
  { key: "vat", label: "VAT" },
];
export const isReportKind = (v: unknown): v is ReportKind => REPORT_TABS.some((t) => t.key === v);

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------
export type PeriodKey = "this-month" | "last-month" | "this-quarter" | "last-quarter" | "tax-year" | "last-tax-year" | "custom";
export const PERIODS: { key: Exclude<PeriodKey, "custom">; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "this-quarter", label: "This quarter" },
  { key: "last-quarter", label: "Last quarter" },
  { key: "tax-year", label: "Tax year" },
  { key: "last-tax-year", label: "Last tax year" },
];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** Month m (1-12, may overflow either way) of year y, normalised. */
const norm = (y: number, m: number): [number, number] => [y + Math.floor((m - 1) / 12), ((((m - 1) % 12) + 12) % 12) + 1];
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthRange = (y: number, m: number) => {
  const [yy, mm] = norm(y, m);
  return { from: iso(yy, mm, 1), to: iso(yy, mm, lastDay(yy, mm)) };
};
const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

export type Period = { key: PeriodKey; from: string; to: string; label: string };

/** The date range a report covers. South African tax year: 1 March to the end of February. Junk falls back to this month. */
export function resolvePeriod(params: { period?: string; from?: string; to?: string }, today: string): Period {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const monthLabel = (yy: number, mm: number) => `${MONTH_NAMES[mm - 1]} ${yy}`;
  const range = (key: PeriodKey, from: string, to: string, label?: string): Period => ({ key, from, to, label: label ?? `${formatDate(from)} to ${formatDate(to)}` });

  switch (params.period) {
    case "last-month": {
      const [yy, mm] = norm(y, m - 1);
      const r = monthRange(yy, mm);
      return range("last-month", r.from, r.to, monthLabel(yy, mm));
    }
    case "this-quarter":
    case "last-quarter": {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1 - (params.period === "last-quarter" ? 3 : 0);
      const [yy, mm] = norm(y, qStart);
      return range(params.period, iso(yy, mm, 1), monthRange(yy, mm + 2).to);
    }
    case "tax-year":
    case "last-tax-year": {
      const startYear = (m >= 3 ? y : y - 1) - (params.period === "last-tax-year" ? 1 : 0);
      return range(params.period, iso(startYear, 3, 1), monthRange(startYear + 1, 2).to, `Tax year ${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`);
    }
    case "custom": {
      const from = params.from ? parseDateZA(params.from) : null;
      const to = params.to ? parseDateZA(params.to) : null;
      if (from && to && from <= to && days(from, to) <= 1830) return range("custom", from, to);
      break;
    }
  }
  const r = monthRange(y, m);
  return range("this-month", r.from, r.to, monthLabel(y, m));
}

// ---------------------------------------------------------------------------
// Tables and CSV
// ---------------------------------------------------------------------------
/** 123456 → "1234.56", -1230 → "-12.30". A plain decimal that spreadsheets read as a number. */
export function centsToDecimal(c: number): string {
  const abs = Math.abs(Math.round(c));
  return `${c < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Text cells that start with = + - @ or a control character would run as formulas in a spreadsheet. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    let s = typeof v === "number" ? String(v) : v;
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export type ReportTable = { title: string; headers: string[]; rows: string[][] };

const BUCKETS = [
  ["current", "Not yet due"],
  ["d1_30", "1 to 30 days overdue"],
  ["d31_60", "31 to 60 days overdue"],
  ["d61_90", "61 to 90 days overdue"],
  ["over_90", "Over 90 days overdue"],
] as const;

/** One report as a plain table of text, in rand: the same rows feed the screen, the CSV and the PDF. */
export function tableFor(r: ReportData, label: string): ReportTable {
  const d = centsToDecimal;
  switch (r.kind) {
    case "pnl": {
      const x = r.data;
      return {
        title: `Profit and loss, ${label}`,
        headers: ["Item", "Amount (R)"],
        rows: [
          ["Invoiced (excluding VAT)", d(x.income_cents)],
          ["Less credit notes", d(-x.credit_cents)],
          ["Net income", d(x.net_income_cents)],
          ...x.expenses_by_category.map((c) => [`Expenses: ${c.category}`, d(-c.cents)]),
          ["Total expenses", d(-x.expenses_cents)],
          ["Profit", d(x.profit_cents)],
        ],
      };
    }
    case "vat": {
      const x = r.data;
      return {
        title: `VAT summary, ${label}`,
        headers: ["Item", "Amount (R)"],
        rows: [
          ["Standard-rated sales (excluding VAT)", d(x.standard_rated_cents)],
          ["Zero-rated sales (excluding VAT)", d(x.zero_rated_cents)],
          ["Output VAT (on sales, less credit notes)", d(x.output_vat_cents)],
          ["Input VAT (on expenses)", d(x.input_vat_cents)],
          ["VAT payable to SARS (output less input)", d(x.net_vat_cents)],
        ],
      };
    }
    case "aged": {
      const x = r.data;
      return {
        title: `Aged debtors as at ${label}`,
        headers: ["Client", "Invoice", "Due", "Days overdue", "Owed"],
        rows: [
          ...x.rows.map((row) => [row.contact, row.number, row.due_date, String(row.days_overdue), d(row.balance_cents)]),
          ...BUCKETS.map(([k, name]) => [name, "", "", "", d(x.totals[k])]),
          ["Total owed", "", "", "", d(x.totals.total)],
        ],
      };
    }
    case "cashflow": {
      const x = r.data;
      return {
        title: "Cash-flow forecast, next 90 days",
        headers: ["Week starting", "Money in", "Money out", "Net", "Running total"],
        rows: [
          ...x.weeks.map((w) => [w.start, d(w.in_cents), d(-w.out_cents), d(w.net_cents), d(w.running_cents)]),
          ["Total", d(x.total_in_cents), d(-x.total_out_cents), d(x.total_in_cents - x.total_out_cents), ""],
        ],
      };
    }
  }
}

/** A table as CSV text: amounts become numbers (so a loss stays "-25.00"), everything else is guarded. */
export function csvFor(t: ReportTable): string {
  const num = /^-?\d+(\.\d+)?$/;
  return toCsv([[t.title], t.headers, ...t.rows.map((row) => row.map((c) => (num.test(c) ? Number(c) : c)))]);
}
