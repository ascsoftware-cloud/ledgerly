import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FileSignature, Receipt } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { loadPortal } from "@/features/portal/public-data";
import { formatDate, todaySAST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

// A portal link is private: never indexed.
export const metadata: Metadata = { title: "Your documents", robots: { index: false, follow: false } };

const STATUS: Record<string, string> = { sent: "Sent", viewed: "Viewed", part_paid: "Part paid", paid: "Paid", accepted: "Accepted", declined: "Declined" };
const KIND: Record<string, string> = { invoice: "Invoice", quote: "Quote", credit_note: "Credit note" };

export default function PortalPage({ params }: PageProps<"/portal/[token]">) {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <Suspense fallback={<PageSkeleton variant="list" />}>
        <Portal params={params} />
      </Suspense>
      <p className="pt-4 text-center text-xs text-muted-foreground">Sent with Ledgerly</p>
    </main>
  );
}

async function Portal({ params }: { params: PageProps<"/portal/[token]">["params"] }) {
  const { token } = await params;
  const res = await loadPortal(token);
  if (res.kind === "busy") return <p role="alert">Too many requests from your connection. Try again in a few minutes.</p>;
  if (res.kind === "missing") notFound();
  const { portal } = res;
  const today = todaySAST();

  const actionFor = (d: (typeof portal.documents)[number]) => {
    if (d.kind === "invoice" && (d.balance_cents ?? 0) > 0) return "View and pay";
    if (d.kind === "quote" && (d.status === "sent" || d.status === "viewed")) return "View and accept";
    return "View";
  };

  return (
    <>
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">From {portal.business}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Your documents</h1>
        <p className="text-muted-foreground">Hi {portal.client}. Everything {portal.business} has sent you is here.</p>
      </header>

      <section aria-labelledby="docs-heading" className="space-y-2">
        <h2 id="docs-heading" className="flex items-center gap-2 font-semibold">
          <Receipt className="size-5" aria-hidden /> Invoices and quotes
        </h2>
        {portal.documents.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card p-6 text-center text-muted-foreground">Nothing has been sent to you yet.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Invoices and quotes">
            {portal.documents.map((d) => {
              const overdue = d.kind === "invoice" && (d.balance_cents ?? 0) > 0 && d.due_date !== null && d.due_date < today;
              return (
                <li key={d.token}>
                  <Link href={`/p/${d.token}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:text-primary">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {KIND[d.kind]} {d.number}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {overdue ? "Overdue" : (STATUS[d.status] ?? d.status)} · {formatDate(d.issue_date)}
                        {d.kind === "invoice" && d.due_date ? ` · due ${formatDate(d.due_date)}` : ""}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-medium tabular-nums">{formatMoney(d.kind === "invoice" ? (d.balance_cents ?? 0) : d.total_cents)}</span>
                      <span className="block text-sm text-primary">{actionFor(d)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {portal.contracts.length > 0 && (
        <section aria-labelledby="contracts-heading" className="space-y-2">
          <h2 id="contracts-heading" className="flex items-center gap-2 font-semibold">
            <FileSignature className="size-5" aria-hidden /> Contracts
          </h2>
          <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Contracts">
            {portal.contracts.map((c) => (
              <li key={c.id}>
                <Link href={`/portal/${token}/contracts/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:text-primary">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{c.title}</span>
                    <span className="block text-sm text-muted-foreground">
                      {c.status === "signed" ? `Signed ${c.signed_at ? formatDate(c.signed_at.slice(0, 10)) : ""}` : "Waiting for your signature"}
                    </span>
                  </span>
                  <span className="text-sm text-primary">{c.status === "signed" ? "View" : "Read and sign"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
