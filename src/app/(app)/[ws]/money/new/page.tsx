import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { contactOptions } from "@/features/pipeline/queries";
import { DocumentEditor } from "@/features/sales/components/document-editor";
import { getBusiness } from "@/features/sales/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "New document", robots: { index: false } };

export default function NewDocumentPage({ params, searchParams }: PageProps<"/[ws]/money/new">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <NewDocument params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function NewDocument({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/money/new">["params"];
  searchParams: PageProps<"/[ws]/money/new">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  const kind = sp.kind === "quote" ? "quote" : "invoice";
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "accountant") notFound();
  const [contacts, business] = await Promise.all([contactOptions(ctx), getBusiness(ctx)]);
  const client = typeof sp.client === "string" && contacts.some((c) => c.id === sp.client) ? sp.client : "";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/${ws}/money`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Money
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{kind === "quote" ? "New quote" : "New invoice"}</h1>
      <DocumentEditor
        slug={ws}
        docId={null}
        kind={kind}
        contacts={contacts}
        vatRegistered={business.vatRegistered}
        initial={client ? { contactId: client, dueDate: "", notes: "", depositType: "none", depositValue: "", lines: [] } : undefined}
      />
    </div>
  );
}
