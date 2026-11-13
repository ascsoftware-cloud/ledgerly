import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { SupplierForm } from "@/features/inventory/components/supplier-form";
import { ArchiveButton } from "@/features/inventory/components/stock-tools";
import { getSupplier } from "@/features/inventory/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Supplier", robots: { index: false } };

export default function SupplierPage({ params }: PageProps<"/[ws]/stock/suppliers/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Supplier params={params} />
    </Suspense>
  );
}

async function Supplier({ params }: { params: PageProps<"/[ws]/stock/suppliers/[id]">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const s = await getSupplier(ctx, id);
  if (!s) notFound();
  const canWrite = ctx.role !== "accountant";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${ws}/stock/suppliers`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Suppliers
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
      {canWrite ? (
        <>
          <SupplierForm slug={ws} supplierId={s.id} initial={{ name: s.name, email: s.email ?? "", phone: s.phone ?? "", notes: s.notes ?? "" }} />
          {!s.deleted_at && <ArchiveButton slug={ws} id={s.id} what="supplier" name={s.name} />}
        </>
      ) : (
        <dl className="space-y-1 rounded-2xl border bg-card p-5 text-sm shadow-card">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{s.email ?? "—"}</dd>
          <dt className="pt-2 text-muted-foreground">Phone</dt>
          <dd>{s.phone ?? "—"}</dd>
        </dl>
      )}
    </div>
  );
}
