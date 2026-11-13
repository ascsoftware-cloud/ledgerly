import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { ArchiveExpense, ViewReceipt } from "@/features/expenses/components/expense-tools";
import { getExpense, isVatRegistered, listCategories } from "@/features/expenses/queries";
import { EXPENSE_METHODS, type ExpenseMethod } from "@/features/expenses/schema";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Expense", robots: { index: false } };

const rand = (cents: number) => (cents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const dmy = (iso: string) => iso.split("-").reverse().join("/");

export default function ExpensePage({ params }: PageProps<"/[ws]/money/expenses/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Expense params={params} />
    </Suspense>
  );
}

async function Expense({ params }: { params: PageProps<"/[ws]/money/expenses/[id]">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const e = await getExpense(ctx, id);
  if (!e || e.deleted_at) notFound();
  const canWrite = ctx.role !== "accountant";
  const title = e.supplier || e.expense_categories?.name || "Expense";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${ws}/money/expenses`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Expenses
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">
            {formatMoney(e.amount_cents)} on {formatDate(e.spent_on)}
            {e.vat_cents > 0 ? ` · VAT ${formatMoney(e.vat_cents)}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {e.receipt_path && <ViewReceipt slug={ws} path={e.receipt_path} />}
          {canWrite && <ArchiveExpense slug={ws} id={e.id} />}
        </div>
      </header>

      {canWrite ? (
        <ExpenseForm
          slug={ws}
          expenseId={e.id}
          categories={await listCategories(ctx)}
          vatRegistered={await isVatRegistered(ctx)}
          initial={{
            amount: rand(e.amount_cents),
            spentOn: dmy(e.spent_on),
            supplier: e.supplier ?? "",
            categoryId: e.category_id ?? "",
            includesVat: e.vat_cents > 0,
            method: e.payment_method ?? "other",
            description: e.description ?? "",
            hasReceipt: !!e.receipt_path,
          }}
        />
      ) : (
        <dl className="grid gap-3 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Category</dt>
            <dd>{e.expense_categories?.name ?? "None"}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Paid by</dt>
            <dd>{EXPENSE_METHODS[(e.payment_method ?? "other") as ExpenseMethod] ?? "Other"}</dd>
          </div>
          {e.description && (
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">Note</dt>
              <dd>{e.description}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
