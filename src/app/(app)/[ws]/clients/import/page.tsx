import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ImportWizard } from "@/features/clients/components/import-wizard";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Import clients", robots: { index: false } };

export default function ImportPage({ params }: PageProps<"/[ws]/clients/import">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Import params={params} />
    </Suspense>
  );
}

async function Import({ params }: { params: PageProps<"/[ws]/clients/import">["params"] }) {
  const { ws } = await params;
  await requireWorkspace(ws);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/clients`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Clients
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Import clients</h1>
        <p className="text-muted-foreground">Nothing is added until every row checks out.</p>
      </div>
      <ImportWizard slug={ws} />
    </div>
  );
}
