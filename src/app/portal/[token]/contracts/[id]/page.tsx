import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { SignContract } from "@/features/portal/components/sign-contract";
import { loadPortalContract } from "@/features/portal/public-data";
import { formatDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Contract", robots: { index: false, follow: false } };

export default function PortalContractPage({ params }: PageProps<"/portal/[token]/contracts/[id]">) {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <Suspense fallback={<PageSkeleton variant="detail" />}>
        <PortalContract params={params} />
      </Suspense>
      <p className="pt-4 text-center text-xs text-muted-foreground">Sent with Ledgerly</p>
    </main>
  );
}

async function PortalContract({ params }: { params: PageProps<"/portal/[token]/contracts/[id]">["params"] }) {
  const { token, id } = await params;
  const res = await loadPortalContract(token, id);
  if (res.kind === "busy") return <p role="alert">Too many requests from your connection. Try again in a few minutes.</p>;
  if (res.kind === "missing") notFound();
  const c = res.contract;

  return (
    <>
      <Link href={`/portal/${token}`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="size-4" aria-hidden /> All your documents
      </Link>
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">From {c.business}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
      </header>
      {/* Plain text, shown as text (never as HTML), with its line breaks kept. */}
      <article aria-label="Contract text" className="whitespace-pre-wrap rounded-2xl border bg-card p-5 leading-relaxed shadow-card">
        {c.body}
      </article>
      {c.status === "signed" ? (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-accent p-4">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
          <span>
            <strong>Signed{c.signer_name ? ` by ${c.signer_name}` : ""}</strong>
            {c.signed_at ? ` on ${formatDate(c.signed_at.slice(0, 10))}` : ""}. You can print this page to keep a copy.
          </span>
        </p>
      ) : (
        <SignContract token={token} contractId={c.id} clientName={c.client} />
      )}
    </>
  );
}
