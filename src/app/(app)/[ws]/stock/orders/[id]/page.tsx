import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { AddOrderLine, OrderActions, RemoveOrderLine } from "@/features/inventory/components/order-tools";
import { getPurchaseOrder, listProducts, poTotal } from "@/features/inventory/queries";
import { formatQty, ORDER_STATUS } from "@/features/inventory/schema";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Purchase order", robots: { index: false } };

export default function OrderPage({ params }: PageProps<"/[ws]/stock/orders/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: { params: PageProps<"/[ws]/stock/orders/[id]">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const o = await getPurchaseOrder(ctx, id);
  if (!o) notFound();
  const canWrite = ctx.role !== "accountant";
  const products = o.status === "draft" && canWrite ? await listProducts(ctx) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/stock/orders`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="size-4" aria-hidden /> Orders
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {o.number} · {o.suppliers?.name ?? "Supplier"}
        </h1>
        <p className="text-muted-foreground">
          {ORDER_STATUS[o.status]}
          {o.expected_on ? ` · expected ${formatDate(o.expected_on)}` : ""}
          {o.received_at ? ` · received ${formatDate(o.received_at.slice(0, 10))}` : ""}
        </p>
        {o.notes && <p className="mt-2 text-sm">{o.notes}</p>}
      </header>

      <section aria-label="Order lines" className="rounded-2xl border bg-card shadow-card">
        {o.purchase_order_lines.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No products on this order yet.</p>
        ) : (
          <ul className="divide-y" aria-label="Products on this order">
            {o.purchase_order_lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.products?.name ?? "Product"}</span>
                  <span className="block text-sm text-muted-foreground">
                    {formatQty(l.quantity)} × {formatMoney(l.unit_cost_cents)}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{formatMoney(Math.round(l.quantity * l.unit_cost_cents))}</span>
                {o.status === "draft" && canWrite && <RemoveOrderLine slug={ws} lineId={l.id} name={l.products?.name ?? "product"} />}
              </li>
            ))}
            <li className="flex justify-between px-4 py-3 font-semibold">
              <span>Total (excluding VAT)</span>
              <span className="tabular-nums">{formatMoney(poTotal(o))}</span>
            </li>
          </ul>
        )}
      </section>

      {o.status === "draft" && canWrite && (
        <AddOrderLine slug={ws} orderId={o.id} products={products.map((p) => ({ id: p.id, name: p.name, costCents: p.costCents }))} />
      )}
      {canWrite && <OrderActions slug={ws} orderId={o.id} status={o.status} hasLines={o.purchase_order_lines.length > 0} />}
    </div>
  );
}
