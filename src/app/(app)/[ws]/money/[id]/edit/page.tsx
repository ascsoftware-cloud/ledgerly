import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { contactOptions } from "@/features/pipeline/queries";
import { pickerProducts } from "@/features/inventory/queries";
import { DocumentEditor } from "@/features/sales/components/document-editor";
import { getDocument } from "@/features/sales/queries";
import { formatDate } from "@/lib/dates";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Edit draft", robots: { index: false } };

const TITLE = { invoice: "Edit invoice", quote: "Edit quote", credit_note: "Edit credit note" } as const;

/** Cents back into what a person would type: 123456 → "1 234,56". */
const rand = (cents: number) => (cents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("/");

export default function EditDocumentPage({ params }: PageProps<"/[ws]/money/[id]/edit">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <EditDocument params={params} />
    </Suspense>
  );
}

async function EditDocument({ params }: { params: PageProps<"/[ws]/money/[id]/edit">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "accountant") notFound();
  const d = await getDocument(ctx, id);
  if (!d) notFound();
  if (d.status !== "draft") redirect(`/${ws}/money/${d.id}`);
  const [contacts, products] = await Promise.all([
    contactOptions(ctx),
    d.kind === "invoice" && ctx.modules.includes("inventory") ? pickerProducts(ctx) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/${ws}/money/${d.id}`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{TITLE[d.kind]}</h1>
        {d.sourceNumber && (
          <p className="text-muted-foreground">
            {d.kind === "credit_note" ? `Reduces invoice ${d.sourceNumber}. Remove what you are not crediting.` : `From quote ${d.sourceNumber}.`}
          </p>
        )}
        <p className="text-sm text-muted-foreground">Started {formatDate(d.issue_date)}</p>
      </div>
      <DocumentEditor
        slug={ws}
        docId={d.id}
        kind={d.kind}
        contacts={contacts}
        vatRegistered={d.business.vatRegistered}
        products={products}
        initial={{
          contactId: d.contact_id,
          dueDate: d.due_date ? ddmmyyyy(d.due_date) : "",
          notes: d.notes ?? "",
          depositType: d.deposit_type ?? "none",
          depositValue:
            d.deposit_type === "pct" ? String(d.deposit_value ?? "") : d.deposit_type === "amount" ? rand(d.deposit_value ?? 0) : "",
          lines: d.lines.map((l) => ({
            key: l.id,
            description: l.description,
            quantity: String(l.quantity).replace(".", ","),
            unitPrice: rand(l.unit_cents),
            discount: l.discount_pct ? String(l.discount_pct).replace(".", ",") : "",
            vat: l.vat_rate === 15 ? "15" : "0",
            productId: l.product_id ?? "",
          })),
        }}
      />
    </div>
  );
}
