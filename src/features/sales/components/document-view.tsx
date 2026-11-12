import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { Business } from "../queries";
import { balanceCents } from "../status";

/** What the document says, laid out like the paper version. Used in the app, on the public page and in the PDF. */
export type DocumentViewData = {
  kind: "invoice" | "quote" | "credit_note";
  number: string | null;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  depositCents: number;
  paidCents: number;
  creditedCents: number;
  sourceNumber: string | null;
  client: { name: string; email: string | null; phone: string | null; address: string | null; company: string | null; companyVat: string | null };
  business: Business;
  lines: { description: string; quantity: number; unitCents: number; discountPct: number; vatRate: number; grossCents: number; netCents: number }[];
};

function title(d: DocumentViewData): string {
  if (d.kind === "quote") return "Quote";
  if (d.kind === "credit_note") return "Credit note";
  // SARS: a VAT-registered supplier issues a "Tax invoice".
  return d.business.vatRegistered ? "Tax invoice" : "Invoice";
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toString().replace(".", ","));

export function DocumentView({ d }: { d: DocumentViewData }) {
  const showVat = d.business.vatRegistered || d.lines.some((l) => l.vatRate > 0);
  const balance = balanceCents(d);
  const bank = d.business.bankDetails;

  return (
    <article aria-label={title(d)} className="rounded-2xl border bg-card p-5 text-sm shadow-card sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-lg font-semibold">{d.business.name}</p>
          {d.business.vatNumber && d.business.vatRegistered && <p className="text-muted-foreground">VAT no. {d.business.vatNumber}</p>}
          {d.business.registrationNumber && <p className="text-muted-foreground">Reg. no. {d.business.registrationNumber}</p>}
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-semibold tracking-tight">{title(d)}</h2>
          <p className="text-muted-foreground">{d.number ?? "Draft"}</p>
        </div>
      </header>

      <div className="grid gap-4 border-b py-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">For</p>
          <p className="font-medium">{d.client.company ?? d.client.name}</p>
          {d.client.company && <p>{d.client.name}</p>}
          {d.client.companyVat && <p className="text-muted-foreground">VAT no. {d.client.companyVat}</p>}
          {d.client.address && <p className="whitespace-pre-line text-muted-foreground">{d.client.address}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:text-right">
          <dt className="text-muted-foreground">Date</dt>
          <dd>{formatDate(d.issueDate)}</dd>
          {d.dueDate && (
            <>
              <dt className="text-muted-foreground">{d.kind === "quote" ? "Valid until" : "Due"}</dt>
              <dd>{formatDate(d.dueDate)}</dd>
            </>
          )}
          {d.sourceNumber && (
            <>
              <dt className="text-muted-foreground">{d.kind === "credit_note" ? "For invoice" : "From quote"}</dt>
              <dd>{d.sourceNumber}</dd>
            </>
          )}
        </dl>
      </div>

      <table className="w-full py-2">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 text-right font-medium">Qty</th>
            <th className="hidden py-2 text-right font-medium sm:table-cell">Price</th>
            {showVat && <th className="hidden py-2 text-right font-medium sm:table-cell">VAT</th>}
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {d.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-2 pr-2">
                {l.description}
                {l.discountPct > 0 && <span className="block text-xs text-muted-foreground">{l.discountPct}% off</span>}
              </td>
              <td className="py-2 text-right tabular-nums">{qty(l.quantity)}</td>
              <td className="hidden py-2 text-right tabular-nums sm:table-cell">{formatMoney(l.unitCents)}</td>
              {showVat && <td className="hidden py-2 text-right tabular-nums sm:table-cell">{l.vatRate}%</td>}
              <td className="py-2 text-right tabular-nums">{formatMoney(showVat ? l.netCents : l.grossCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-4 grid max-w-xs grid-cols-2 gap-y-1 border-t pt-4 tabular-nums">
        {showVat && (
          <>
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right">{formatMoney(d.subtotalCents)}</dd>
            <dt className="text-muted-foreground">VAT</dt>
            <dd className="text-right">{formatMoney(d.vatCents)}</dd>
          </>
        )}
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold">{formatMoney(d.totalCents)}</dd>
        {d.depositCents > 0 && d.kind !== "credit_note" && (
          <>
            <dt className="text-muted-foreground">Deposit due</dt>
            <dd className="text-right">{formatMoney(d.depositCents)}</dd>
          </>
        )}
        {(d.paidCents > 0 || d.creditedCents > 0) && (
          <>
            {d.paidCents > 0 && (
              <>
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="text-right">−{formatMoney(d.paidCents)}</dd>
              </>
            )}
            {d.creditedCents > 0 && (
              <>
                <dt className="text-muted-foreground">Credited</dt>
                <dd className="text-right">−{formatMoney(d.creditedCents)}</dd>
              </>
            )}
            <dt className="font-semibold">Balance</dt>
            <dd className="text-right font-semibold">{formatMoney(balance)}</dd>
          </>
        )}
      </dl>

      {(d.notes || (bank && d.kind === "invoice")) && (
        <footer className="mt-6 space-y-4 border-t pt-5">
          {d.notes && <p className="whitespace-pre-line">{d.notes}</p>}
          {bank && d.kind === "invoice" && (
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Pay by EFT</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4">
                {Object.entries(bank).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
                {d.number && (
                  <>
                    <dt className="text-muted-foreground">Reference</dt>
                    <dd className="font-medium">{d.number}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </footer>
      )}
    </article>
  );
}
