import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { SupplierForm } from "@/features/inventory/components/supplier-form";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Add a supplier", robots: { index: false } };

export default function NewSupplierPage({ params }: PageProps<"/[ws]/stock/suppliers/new">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <NewSupplier params={params} />
    </Suspense>
  );
}

async function NewSupplier({ params }: { params: PageProps<"/[ws]/stock/suppliers/new">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "accountant") notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${ws}/stock/suppliers`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Suppliers
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add a supplier</h1>
      <SupplierForm slug={ws} />
    </div>
  );
}
