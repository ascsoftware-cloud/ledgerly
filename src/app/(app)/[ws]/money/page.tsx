import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileText, Plus, ScrollText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { MoneySections } from "@/features/expenses/components/money-sections";
import { StatusBadge } from "@/features/sales/components/status-badge";
import { listDocuments } from "@/features/sales/queries";
import { balanceCents, effectiveStatus } from "@/features/sales/status";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Money", robots: { index: false } };

const TABS = [
  { key: "invoices", label: "Invoices", kind: "invoice" },
  { key: "quotes", label: "Quotes", kind: "quote" },
  { key: "credits", label: "Credit notes", kind: "credit_note" },
] as const;

export default function MoneyPage({ params, searchParams }: PageProps<"/[ws]/money">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Money params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Money({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/money">["params"];
  searchParams: PageProps<"/[ws]/money">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const ctx = await requireWorkspace(ws);
  const docs = await listDocuments(ctx, tab.kind);
  const canWrite = ctx.role !== "accountant";
  const owed = docs
    .filter((d) => d.kind === "invoice" && !["draft", "void", "paid"].includes(d.status))
    .reduce((s, d) => s + balanceCents({ totalCents: d.total_cents, paidCents: d.paid_cents, creditedCents: d.credited_cents }), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Money</h1>
        {canWrite && (
          <div className="flex gap-2">
            <Link href={`/${ws}/money/new?kind=quote`} className={buttonVariants({ variant: "outline", size: "touch" })}>
              <ScrollText className="size-5" aria-hidden /> New quote
            </Link>
            <Link href={`/${ws}/money/new?kind=invoice`} className={buttonVariants({ size: "touch" })}>
              <Plus className="size-5" aria-hidden /> New invoice
            </Link>
          </div>
        )}
      </header>

      <MoneySections slug={ws} current="sales" showBank={ctx.role !== "staff"} />

      <nav aria-label="Document types" className="inline-flex rounded-xl bg-muted p-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/${ws}/money?tab=${t.key}`}
            aria-current={t.key === tab.key ? "page" : undefined}
            className="flex h-11 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab.kind === "invoice" && docs.length > 0 && (
        <p className="text-muted-foreground">
          <span className="font-semibold text-foreground">{formatMoney(owed)}</span> still to come in.
        </p>
      )}

      {docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={tab.kind === "invoice" ? "No invoices yet" : tab.kind === "quote" ? "No quotes yet" : "No credit notes"}
          body={
            tab.kind === "credit_note"
              ? "Credit notes appear here when you refund or reduce a sent invoice."
              : "Create one in under a minute. Your client can view it and pay on their phone."
          }
          action={
            canWrite && tab.kind !== "credit_note"
              ? { label: tab.kind === "invoice" ? "Create your first invoice" : "Create your first quote", href: `/${ws}/money/new?kind=${tab.kind}` }
              : { label: "Back to home", href: `/${ws}` }
          }
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label={tab.label}>
          {docs.map((d) => {
            const shown = effectiveStatus({ status: d.status, dueDate: d.due_date });
            return (
              <li key={d.id}>
                <Link href={`/${ws}/money/${d.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {d.contacts?.name ?? "Unknown client"}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {d.number ?? "Draft"}
                      {d.due_date && d.status !== "draft" ? ` · due ${formatDate(d.due_date)}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="font-medium tabular-nums">{formatMoney(d.total_cents)}</span>
                    <StatusBadge status={shown} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
