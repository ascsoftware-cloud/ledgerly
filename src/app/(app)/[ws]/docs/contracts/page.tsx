import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileSignature, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { DocSections } from "@/features/documents/components/doc-sections";
import { listContracts } from "@/features/documents/queries";
import { CONTRACT_STATUS_LABEL } from "@/features/documents/schema";
import { formatDate } from "@/lib/dates";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Contracts", robots: { index: false } };

export default function ContractsPage({ params }: PageProps<"/[ws]/docs/contracts">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Contracts params={params} />
    </Suspense>
  );
}

async function Contracts({ params }: { params: PageProps<"/[ws]/docs/contracts">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const canWrite = ctx.role !== "accountant";
  const contracts = await listContracts(ctx);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        {canWrite && (
          <Link href={`/${ws}/docs/contracts/new`} className={buttonVariants({ size: "touch" })}>
            <Plus className="size-5" aria-hidden /> New contract
          </Link>
        )}
      </header>
      <DocSections slug={ws} current="contracts" />
      {contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="No contracts yet"
          body="Make a contract from a template, send your client a link, and they can read and sign it on their phone."
          action={{ label: "Make a contract", href: `/${ws}/docs/contracts/new` }}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Contracts">
          {contracts.map((c) => (
            <li key={c.id}>
              <Link href={`/${ws}/docs/contracts/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:text-primary">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {c.contacts?.name ?? "Client"} · {formatDate(c.created_at.slice(0, 10))}
                  </span>
                </span>
                <span className={`text-sm font-medium ${c.status === "signed" ? "text-success" : ""}`}>{CONTRACT_STATUS_LABEL[c.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
