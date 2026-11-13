import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PERIODS, REPORT_TABS, type Period, type ReportData, type ReportKind } from "../schema";

const tabClass =
  "flex h-11 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card";

function href(ws: string, kind: ReportKind, p: Pick<Period, "key" | "from" | "to">) {
  const q = new URLSearchParams({ r: kind, period: p.key });
  if (p.key === "custom") {
    q.set("from", p.from);
    q.set("to", p.to);
  }
  return `/${ws}/reports?${q}`;
}

export function ReportTabs({ ws, current, period }: { ws: string; current: ReportKind; period: Period }) {
  return (
    <nav aria-label="Reports" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-muted p-1">
      {REPORT_TABS.map((t) => (
        <Link key={t.key} href={href(ws, t.key, period)} aria-current={current === t.key ? "page" : undefined} className={`${tabClass} shrink-0`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Presets plus a from/to form. Plain links and a GET form: no script needed. */
export function PeriodPicker({ ws, kind, period }: { ws: string; kind: ReportKind; period: Period }) {
  const field = "h-11 w-32 rounded-xl border bg-background px-3 text-base";
  return (
    <section aria-label="Period" className="space-y-3">
      <ul className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <li key={p.key}>
            <Link
              href={`/${ws}/reports?r=${kind}&period=${p.key}`}
              aria-current={period.key === p.key ? "true" : undefined}
              className="inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium hover:border-primary aria-[current=true]:border-primary aria-[current=true]:bg-accent"
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
      <form method="get" action={`/${ws}/reports`} aria-label="Custom dates" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="r" value={kind} />
        <input type="hidden" name="period" value="custom" />
        <label className="space-y-1 text-sm font-medium">
          From
          <input name="from" defaultValue={period.key === "custom" ? formatDmy(period.from) : ""} placeholder="01/10/2026" inputMode="numeric" className={field} />
        </label>
        <label className="space-y-1 text-sm font-medium">
          To
          <input name="to" defaultValue={period.key === "custom" ? formatDmy(period.to) : ""} placeholder="31/10/2026" inputMode="numeric" className={field} />
        </label>
        <button type="submit" className={buttonVariants({ variant: "outline", size: "touch" })}>
          Show
        </button>
      </form>
    </section>
  );
}

const formatDmy = (iso: string) => iso.split("-").reverse().join("/");

export function ExportLinks({ ws, kind, period }: { ws: string; kind: ReportKind; period: Period }) {
  const q = new URLSearchParams({ r: kind, period: period.key });
  if (period.key === "custom") {
    q.set("from", period.from);
    q.set("to", period.to);
  }
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <a href={`/${ws}/reports/export?${q}&format=csv`} className={buttonVariants({ variant: "outline", size: "touch" })}>
        <Download className="size-5" aria-hidden /> CSV
      </a>
      <a href={`/${ws}/reports/export?${q}&format=pdf`} className={buttonVariants({ variant: "outline", size: "touch" })}>
        <FileText className="size-5" aria-hidden /> PDF
      </a>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-success" : ""}`}>{value}</dd>
    </div>
  );
}

function Rows({ rows, caption }: { rows: [string, number, boolean?][]; caption: string }) {
  return (
    <table className="w-full rounded-2xl border bg-card text-sm shadow-card">
      <caption className="sr-only">{caption}</caption>
      <tbody className="divide-y">
        {rows.map(([label, cents, bold]) => (
          <tr key={label} className={bold ? "font-semibold" : ""}>
            <th scope="row" className="px-4 py-3 text-left font-normal">
              <span className={bold ? "font-semibold" : ""}>{label}</span>
            </th>
            <td className="px-4 py-3 text-right tabular-nums">{formatMoney(cents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReportView({ report, label }: { report: ReportData; label: string }) {
  switch (report.kind) {
    case "pnl": {
      const x = report.data;
      return (
        <div className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat label="Net income" value={formatMoney(x.net_income_cents)} />
            <Stat label="Expenses" value={formatMoney(x.expenses_cents)} />
            <Stat label="Profit" value={formatMoney(x.profit_cents)} tone={x.profit_cents < 0 ? "bad" : "good"} />
          </dl>
          <Rows
            caption={`Profit and loss, ${label}`}
            rows={[
              [`Invoiced (${x.invoice_count} ${x.invoice_count === 1 ? "invoice" : "invoices"}, excluding VAT)`, x.income_cents],
              ["Less credit notes", -x.credit_cents],
              ["Net income", x.net_income_cents, true],
              ...x.expenses_by_category.map((c) => [`Expenses: ${c.category}`, -c.cents] as [string, number]),
              ["Total expenses", -x.expenses_cents, true],
              ["Profit", x.profit_cents, true],
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Counted when invoices are sent (not when they are paid), without VAT. Expenses are without the VAT you can claim back. Quotes, drafts and voided invoices are left out.
          </p>
        </div>
      );
    }
    case "vat": {
      const x = report.data;
      return (
        <div className="space-y-4">
          {!x.vat_registered && (
            <p role="status" className="rounded-xl border bg-muted p-3 text-sm">
              Your business is not set up as VAT-registered, so invoices carry no VAT. Add your VAT number in the business details if that has changed.
            </p>
          )}
          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat label="Output VAT (on sales)" value={formatMoney(x.output_vat_cents)} />
            <Stat label="Input VAT (on expenses)" value={formatMoney(x.input_vat_cents)} />
            <Stat label={x.net_vat_cents < 0 ? "SARS owes you" : "Payable to SARS"} value={formatMoney(Math.abs(x.net_vat_cents))} tone={x.net_vat_cents < 0 ? "good" : undefined} />
          </dl>
          <Rows
            caption={`VAT summary, ${label}`}
            rows={[
              ["Standard-rated sales (excluding VAT)", x.standard_rated_cents],
              ["Zero-rated sales (excluding VAT)", x.zero_rated_cents],
              ["Output VAT (on sales, less credit notes)", x.output_vat_cents],
              ["Input VAT (on expenses)", x.input_vat_cents],
              ["VAT payable to SARS (output less input)", x.net_vat_cents, true],
            ]}
          />
          <p className="text-sm text-muted-foreground">
            A summary to help with your return, on an invoice basis. VAT vendors usually file every two months: pick the two months you are filing for. Your accountant or SARS eFiling has the final say.
          </p>
        </div>
      );
    }
    case "aged": {
      const x = report.data;
      const buckets: [string, number][] = [
        ["Not yet due", x.totals.current],
        ["1 to 30 days", x.totals.d1_30],
        ["31 to 60 days", x.totals.d31_60],
        ["61 to 90 days", x.totals.d61_90],
        ["Over 90 days", x.totals.over_90],
      ];
      return (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {buckets.map(([name, c], i) => (
              <Stat key={name} label={name} value={formatMoney(c)} tone={i >= 3 && c > 0 ? "bad" : undefined} />
            ))}
          </dl>
          <p className="font-semibold">
            Total owed to you: <span className="tabular-nums">{formatMoney(x.totals.total)}</span>
          </p>
          {x.rows.length === 0 ? (
            <p className="rounded-2xl border border-dashed bg-card p-6 text-center text-muted-foreground">Nobody owes you anything right now.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
              <table className="w-full text-sm">
                <caption className="sr-only">Unpaid invoices as at {label}</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">Client</th>
                    <th scope="col" className="px-4 py-3 font-medium">Invoice</th>
                    <th scope="col" className="px-4 py-3 font-medium">Due</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Days overdue</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Owed</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {x.rows.map((row) => (
                    <tr key={row.number}>
                      <td className="px-4 py-3">{row.contact}</td>
                      <td className="px-4 py-3">{row.number}</td>
                      <td className="px-4 py-3">{formatDate(row.due_date)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.days_overdue > 0 ? row.days_overdue : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatMoney(row.balance_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }
    case "cashflow": {
      const x = report.data;
      const biggest = Math.max(1, ...x.weeks.flatMap((w) => [w.in_cents, w.out_cents]));
      return (
        <div className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat label="Expected in" value={formatMoney(x.total_in_cents)} tone="good" />
            <Stat label="Expected out" value={formatMoney(x.total_out_cents)} />
            <Stat label="Net over 90 days" value={formatMoney(x.total_in_cents - x.total_out_cents)} tone={x.total_in_cents - x.total_out_cents < 0 ? "bad" : "good"} />
          </dl>
          <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
            <table className="w-full text-sm">
              <caption className="sr-only">Cash-flow forecast by week</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Week starting</th>
                  <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Chart</span></th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">In</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Out</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Running total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {x.weeks.map((w) => (
                  <tr key={w.start}>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(w.start)}</td>
                    <td className="w-40 px-4 py-3" aria-hidden>
                      <span className="block h-2 rounded-full bg-success/70" style={{ width: `${(w.in_cents / biggest) * 100}%` }} />
                      <span className="mt-1 block h-2 rounded-full bg-destructive/60" style={{ width: `${(w.out_cents / biggest) * 100}%` }} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(w.in_cents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(w.out_cents)}</td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${w.running_cents < 0 ? "text-destructive" : ""}`}>{formatMoney(w.running_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            Unpaid invoices are counted on their due date (overdue ones in the first week) and repeating costs on their schedule. Repeating invoices, one-off bills and your bank balance are not included, so read it as a guide to the direction of travel.
          </p>
        </div>
      );
    }
  }
}
