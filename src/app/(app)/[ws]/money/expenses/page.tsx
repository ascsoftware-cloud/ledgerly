import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, Paperclip, Plus, Receipt, Repeat } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { MoneySections } from "@/features/expenses/components/money-sections";
import { StopRecurring, UndoExpenseArchive } from "@/features/expenses/components/expense-tools";
import { listExpenses, listRecurring } from "@/features/expenses/queries";
import { CADENCES } from "@/features/expenses/schema";
import { formatDate, todaySAST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Expenses", robots: { index: false } };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default function ExpensesPage({ params, searchParams }: PageProps<"/[ws]/money/expenses">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Expenses params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Expenses({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/money/expenses">["params"];
  searchParams: PageProps<"/[ws]/money/expenses">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  // requireWorkspace marks the request dynamic (connection()) before the clock is read.
  const ctx = await requireWorkspace(ws);
  const thisMonth = todaySAST().slice(0, 7);
  const month = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : thisMonth;
  const [rows, recurring] = await Promise.all([listExpenses(ctx, month), listRecurring(ctx)]);
  const canManage = ctx.role === "owner" || ctx.role === "admin";
  const canWrite = ctx.role !== "accountant";
  const total = rows.reduce((s, r) => s + r.amount_cents, 0);
  const vat = rows.reduce((s, r) => s + r.vat_cents, 0);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const label = `${MONTHS[m - 1]} ${y}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Money</h1>
        {canWrite && (
          <Link href={`/${ws}/money/expenses/new`} className={buttonVariants({ size: "touch" })}>
            <Plus className="size-5" aria-hidden /> Log expense
          </Link>
        )}
      </header>
      <MoneySections slug={ws} current="expenses" />
      {canWrite && typeof sp.archived === "string" && /^[0-9a-f-]{36}$/.test(sp.archived) && <UndoExpenseArchive slug={ws} id={sp.archived} />}

      <section aria-label="Month" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-accent p-4">
        <div className="flex items-center gap-1">
          <Link href={`/${ws}/money/expenses?month=${shift(month, -1)}`} aria-label="Previous month" className={buttonVariants({ variant: "ghost", size: "icon-touch" })}>
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
          <h2 className="min-w-24 text-center font-semibold">{label}</h2>
          {month < thisMonth ? (
            <Link href={`/${ws}/money/expenses?month=${shift(month, 1)}`} aria-label="Next month" className={buttonVariants({ variant: "ghost", size: "icon-touch" })}>
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          ) : (
            <span className="size-11" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Spent <span className="font-semibold text-foreground tabular-nums">{formatMoney(total)}</span>
          {vat > 0 && (
            <>
              {" "}· VAT to claim <span className="font-semibold text-foreground tabular-nums">{formatMoney(vat)}</span>
            </>
          )}
        </p>
      </section>

      {recurring.length > 0 && (
        <section aria-labelledby="repeating-heading" className="rounded-2xl border bg-card p-5 shadow-card">
          <h2 id="repeating-heading" className="flex items-center gap-2 font-semibold">
            <Repeat className="size-5" aria-hidden /> Repeating costs
          </h2>
          <ul className="mt-2 divide-y text-sm">
            {recurring.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {c.supplier} · {CADENCES[c.cadence].toLowerCase()} · next {formatDate(c.next_date)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">{formatMoney(c.amount_cents)}</span>
                  {canManage && <StopRecurring slug={ws} id={c.id} label={c.supplier} />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={`No expenses in ${label}`}
          body="Snap a receipt or type the amount. Knowing what goes out shows what you really make."
          action={canWrite ? { label: "Log an expense", href: `/${ws}/money/expenses/new` } : { label: "Back to home", href: `/${ws}` }}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label={`Expenses in ${label}`}>
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/${ws}/money/expenses/${r.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate font-medium">
                    {r.supplier || r.expense_categories?.name || "Expense"}
                    {r.receipt_path && <Paperclip className="size-4 text-muted-foreground" aria-label="has receipt" />}
                    {r.recurring_id && <Repeat className="size-4 text-muted-foreground" aria-label="recurring" />}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {formatDate(r.spent_on)}
                    {r.expense_categories ? ` · ${r.expense_categories.name}` : ""}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{formatMoney(r.amount_cents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
