import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Landmark } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { BankImport } from "@/features/bank/components/bank-import";
import { BankLineItem, DeleteImport } from "@/features/bank/components/bank-line";
import { suggestMatch } from "@/features/bank/parse";
import { listBankLines, listImports, openInvoices } from "@/features/bank/queries";
import { formatDate } from "@/lib/dates";
import { MoneySections } from "@/features/expenses/components/money-sections";
import { listCategories } from "@/features/expenses/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Bank", robots: { index: false } };

export default function BankPage({ params, searchParams }: PageProps<"/[ws]/money/bank">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Bank params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Bank({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/money/bank">["params"];
  searchParams: PageProps<"/[ws]/money/bank">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  // Bank statements are for owners, admins and the accountant (read-only).
  if (ctx.role === "staff") notFound();
  const canWrite = ctx.role === "owner" || ctx.role === "admin";
  const view = sp.view === "all" ? "all" : "todo";
  const [lines, invoices, categories, imports] = await Promise.all([listBankLines(ctx, view), openInvoices(ctx), listCategories(ctx), listImports(ctx)]);

  const tab = (key: "todo" | "all", label: string) => (
    <Link
      href={`/${ws}/money/bank${key === "all" ? "?view=all" : ""}`}
      aria-current={view === key ? "page" : undefined}
      className="flex h-11 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Money</h1>
      <MoneySections slug={ws} current="bank" />
      {canWrite && <BankImport slug={ws} />}

      <nav aria-label="Statement lines" className="inline-flex rounded-xl bg-muted p-1">
        {tab("todo", "To do")}
        {tab("all", "All lines")}
      </nav>

      {lines.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title={view === "todo" ? "Nothing to sort out" : "No statements yet"}
          body={
            view === "todo"
              ? "Every imported line is matched, logged or ignored. Import a newer statement when you have one."
              : "Import a CSV from your bank to match payments to invoices and log expenses in a few taps."
          }
          action={{ label: view === "todo" ? "See all lines" : "Back to Money", href: view === "todo" ? `/${ws}/money/bank?view=all` : `/${ws}/money` }}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label={view === "todo" ? "Lines to sort out" : "All statement lines"}>
          {lines.map((l) => (
            <BankLineItem
              key={l.id}
              slug={ws}
              canWrite={canWrite}
              line={{ ...l, number: l.sales_documents?.number ?? null }}
              invoices={invoices}
              suggested={l.status === "new" ? (suggestMatch({ amountCents: l.amount_cents, description: l.description }, invoices)?.id ?? null) : null}
              categories={categories}
            />
          ))}
        </ul>
      )}
      {canWrite && imports.length > 0 && (
        <details className="rounded-2xl border bg-card p-4">
          <summary className="cursor-pointer font-medium">Recent imports</summary>
          <ul className="mt-2 divide-y text-sm" aria-label="Recent imports">
            {imports.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                <span>
                  {i.file_name} · {formatDate(i.created_at.slice(0, 10))} · {i.added_count} line{i.added_count === 1 ? "" : "s"}
                </span>
                <DeleteImport slug={ws} id={i.id} name={i.file_name} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
