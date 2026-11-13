import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { isVatRegistered } from "@/features/expenses/queries";
import { ProductForm } from "@/features/inventory/components/product-form";
import { listSuppliers } from "@/features/inventory/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Add a product", robots: { index: false } };

export default function NewProductPage({ params }: PageProps<"/[ws]/stock/new">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <NewProduct params={params} />
    </Suspense>
  );
}

async function NewProduct({ params }: { params: PageProps<"/[ws]/stock/new">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "accountant") notFound();
  const [suppliers, vatRegistered] = await Promise.all([listSuppliers(ctx), isVatRegistered(ctx)]);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${ws}/stock`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Stock
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add a product</h1>
      <ProductForm slug={ws} suppliers={suppliers} vatRegistered={vatRegistered} />
    </div>
  );
}
