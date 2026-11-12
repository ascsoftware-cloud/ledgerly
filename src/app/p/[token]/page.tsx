import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { AcceptQuote } from "@/features/sales/components/accept-quote";
import { DocumentView } from "@/features/sales/components/document-view";
import { publicToViewData } from "@/features/sales/public";
import { loadPublicDocument } from "@/features/sales/public-data";
import { balanceCents } from "@/features/sales/status";
import { formatDate, todaySAST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createServerClient } from "@/lib/supabase/server";

// Shared links must never appear in search results.
export const metadata: Metadata = { title: "Your document", robots: { index: false, follow: false } };

export default function PublicDocumentPage({ params }: PageProps<"/p/[token]">) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <Suspense fallback={<PageSkeleton variant="detail" />}>
        <PublicDocument params={params} />
      </Suspense>
      <p className="pt-4 text-center text-xs text-muted-foreground">Sent with Ledgerly</p>
    </main>
  );
}

async function PublicDocument({ params }: { params: PageProps<"/p/[token]">["params"] }) {
  const { token } = await params;
  const res = await loadPublicDocument(token);
  if (res.kind === "busy") {
    return <p role="alert">Too many requests from your connection. Try again in a few minutes.</p>;
  }
  if (res.kind === "missing") notFound();
  const doc = res.doc;

  // First open lets the business know. Failure here never blocks the page.
  const supabase = await createServerClient();
  await supabase.rpc("mark_document_viewed", { p_token: token }).then(
    () => undefined,
    () => undefined,
  );

  const view = publicToViewData(doc);
  const balance = balanceCents(view);
  const quoteOpen = doc.kind === "quote" && (doc.status === "sent" || doc.status === "viewed");
  const expired = quoteOpen && doc.due_date !== null && doc.due_date < todaySAST();

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">From {doc.business.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {doc.kind === "quote" ? "Quote" : doc.kind === "credit_note" ? "Credit note" : "Invoice"} {doc.number}
          </h1>
        </div>
        <a href={`/p/${token}/pdf`} className={buttonVariants({ variant: "outline", size: "touch" })}>
          <Download className="size-5" aria-hidden /> Download PDF
        </a>
      </header>

      {doc.status === "void" && (
        <p role="status" className="rounded-xl border bg-muted px-4 py-3">
          This document was cancelled by {doc.business.name}. Nothing is owed on it.
        </p>
      )}

      {doc.kind === "invoice" && doc.status !== "void" && (
        <section aria-label="Amount due" className="rounded-2xl bg-accent p-5">
          {balance > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">Amount due{doc.due_date ? ` by ${formatDate(doc.due_date)}` : ""}</p>
              <p className="text-3xl font-semibold tracking-tight">{formatMoney(balance)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {doc.business.bank_details
                  ? `Pay by EFT using the details below, with ${doc.number} as the reference.`
                  : `Contact ${doc.business.name} for payment details.`}
              </p>
            </>
          ) : (
            <p className="flex items-center gap-2 text-lg font-semibold">
              <CheckCircle2 className="size-6 text-success" aria-hidden /> Paid in full. Thank you!
            </p>
          )}
        </section>
      )}

      {doc.kind === "quote" && doc.status === "accepted" && doc.accepted_at && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-4 py-3">
          <CheckCircle2 className="size-5 text-success" aria-hidden /> Accepted on {formatDate(todaySAST(new Date(doc.accepted_at)))}.
        </p>
      )}
      {quoteOpen && !expired && <AcceptQuote token={token} business={doc.business.name} />}
      {expired && (
        <p role="status" className="rounded-xl border bg-muted px-4 py-3">
          This quote has expired. Ask {doc.business.name} for a new one.
        </p>
      )}

      <DocumentView d={view} />
    </>
  );
}
