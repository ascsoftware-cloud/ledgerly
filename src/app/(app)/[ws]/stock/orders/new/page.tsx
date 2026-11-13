import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { NewOrderForm } from "@/features/inventory/components/order-tools";
import { listSuppliers } from "@/features/inventory/queries";
import { requireWorkspace } from "@/lib/workspace";
import { Truck } from "lucide-react";

export const metadata: Metadata = { title: "New purchase order", robots: { index: false } };

export default function NewOrderPage({ params }: PageProps<"/[ws]/stock/orders/new">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <NewOrder params={params} />
    </Suspense>
  );
}

async function NewOrder({ params }: { params: PageProps<"/[ws]/stock/orders/new">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "accountant") notFound();
  const suppliers = await listSuppliers(ctx);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${ws}/stock/orders`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Orders
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New purchase order</h1>
      {suppliers.length === 0 ? (
        <EmptyState icon={Truck} title="Add a supplier first" body="An order is made out to a supplier." action={{ label: "Add a supplier", href: `/${ws}/stock/suppliers/new` }} />
      ) : (
        <NewOrderForm slug={ws} suppliers={suppliers} />
      )}
    </div>
  );
}
