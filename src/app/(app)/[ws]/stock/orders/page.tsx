import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { StockSections } from "@/features/inventory/components/stock-sections";
import { listPurchaseOrders, poTotal } from "@/features/inventory/queries";
import { ORDER_STATUS } from "@/features/inventory/schema";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Purchase orders", robots: { index: false } };

export default function OrdersPage({ params }: PageProps<"/[ws]/stock/orders">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Orders params={params} />
    </Suspense>
  );
}

async function Orders({ params }: { params: PageProps<"/[ws]/stock/orders">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const canWrite = ctx.role !== "accountant";
  const orders = await listPurchaseOrders(ctx);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
        {canWrite && (
          <Link href={`/${ws}/stock/orders/new`} className={buttonVariants({ size: "touch" })}>
            <Plus className="size-5" aria-hidden /> New order
          </Link>
        )}
      </header>
      <StockSections slug={ws} current="orders" />
      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No orders yet"
          body="Order stock from a supplier, then mark it received when the goods arrive. Your stock count goes up by itself."
          action={{ label: "Start an order", href: `/${ws}/stock/orders/new` }}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Purchase orders">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/${ws}/stock/orders/${o.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:text-primary">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {o.number} · {o.suppliers?.name ?? "Supplier"}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {ORDER_STATUS[o.status]} · {formatDate(o.created_at.slice(0, 10))}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{formatMoney(poTotal(o))}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
