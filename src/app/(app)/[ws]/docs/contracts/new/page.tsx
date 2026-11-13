import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { NewContractForm } from "@/features/documents/components/contract-form";
import { listTemplates } from "@/features/documents/queries";
import { contactOptions } from "@/features/pipeline/queries";
import { requireWorkspace } from "@/lib/workspace";
import { Users } from "lucide-react";

export const metadata: Metadata = { title: "New contract", robots: { index: false } };

export default function NewContractPage({ params, searchParams }: PageProps<"/[ws]/docs/contracts/new">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <NewContract params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function NewContract({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/docs/contracts/new">["params"];
  searchParams: PageProps<"/[ws]/docs/contracts/new">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "accountant") notFound();
  const [contacts, templates] = await Promise.all([contactOptions(ctx), listTemplates(ctx)]);
  const client = typeof sp.client === "string" && contacts.some((c) => c.id === sp.client) ? sp.client : "";
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/docs/contracts`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Contracts
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New contract</h1>
      {contacts.length === 0 ? (
        <EmptyState icon={Users} title="Add a client first" body="A contract is made for one client." action={{ label: "Add a client", href: `/${ws}/clients/new` }} />
      ) : (
        <NewContractForm slug={ws} contacts={contacts} templates={templates} initialContact={client} />
      )}
    </div>
  );
}
