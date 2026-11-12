import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { DocumentActions } from "@/features/sales/components/document-actions";
import { DocumentView } from "@/features/sales/components/document-view";
import { StatusBadge } from "@/features/sales/components/status-badge";
import { getDocument } from "@/features/sales/queries";
import { effectiveStatus } from "@/features/sales/status";
import { toViewData } from "@/features/sales/view-data";
import { formatMoney } from "@/lib/money";
import { siteUrl } from "@/lib/site-url";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Document", robots: { index: false } };

const WORD = { invoice: "invoice", quote: "quote", credit_note: "credit note" } as const;

export default function DocumentPage({ params }: PageProps<"/[ws]/money/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Document params={params} />
    </Suspense>
  );
}

async function Document({ params }: { params: PageProps<"/[ws]/money/[id]">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const d = await getDocument(ctx, id);
  if (!d) notFound();
  const shown = effectiveStatus({ status: d.status, dueDate: d.due_date });
  const shareUrl = `${siteUrl()}/p/${d.public_token}`;
  const whatsappText = `Hi ${d.contacts.name.split(" ")[0]}, here is your ${WORD[d.kind]} ${d.number ?? ""} from ${d.business.name} for ${formatMoney(d.total_cents)}: ${shareUrl}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/${ws}/money`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Money
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {d.number ?? `Draft ${WORD[d.kind]}`}
          </h1>
          <StatusBadge status={shown} />
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/${ws}/clients/${d.contact_id}`} className="text-sm text-muted-foreground hover:text-primary">
            {d.contacts.name}
          </Link>
          <a href={`/api/documents/${d.id}/pdf?ws=${ws}`} className={buttonVariants({ variant: "ghost", size: "touch" })}>
            <Download className="size-5" aria-hidden /> PDF
          </a>
        </div>
      </header>
      <DocumentActions
        slug={ws}
        id={d.id}
        kind={d.kind}
        status={shown}
        number={d.number}
        role={ctx.role}
        shareUrl={shareUrl}
        whatsappText={whatsappText}
        clientPhone={d.contacts.phone}
      />
      <DocumentView d={toViewData(d)} />
    </div>
  );
}
