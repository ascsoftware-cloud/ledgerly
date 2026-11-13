import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Package, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { RestoreButton } from "@/features/inventory/components/stock-tools";
import { StockSections } from "@/features/inventory/components/stock-sections";
import { listProducts } from "@/features/inventory/queries";
import { formatQty, lowStock, STOCK_STATE_LABEL, stockState } from "@/features/inventory/schema";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Stock", robots: { index: false } };

export default function StockPage({ params, searchParams }: PageProps<"/[ws]/stock">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Stock params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Stock({ params, searchParams }: { params: PageProps<"/[ws]/stock">["params"]; searchParams: PageProps<"/[ws]/stock">["searchParams"] }) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  const archived = sp.show === "archived";
  const canWrite = ctx.role !== "accountant";
  const products = await listProducts(ctx, archived);
  const needs = archived ? [] : lowStock(products);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
        {canWrite && (
          <Link href={`/${ws}/stock/new`} className={buttonVariants({ size: "touch" })}>
            <Plus className="size-5" aria-hidden /> Add product
          </Link>
        )}
      </header>
      <StockSections slug={ws} current="products" />

      {needs.length > 0 && (
        <section aria-label="Low stock" role="status" className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-5" aria-hidden /> {needs.length} {needs.length === 1 ? "product needs" : "products need"} re-ordering
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {needs.map((p) => (
              <li key={p.id}>
                <Link href={`/${ws}/stock/${p.id}`} className="inline-flex min-h-11 items-center rounded-lg bg-card px-3 font-medium hover:text-primary">
                  {p.name} · {formatQty(p.stockQty)} left
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {products.length === 0 ? (
        <EmptyState
          icon={Package}
          title={archived ? "Nothing archived" : "No products yet"}
          body={archived ? "Products you archive are kept here so you can bring them back." : "Add what you sell, with its price and how many you have. Invoices will take stock off by themselves."}
          action={archived ? { label: "Back to products", href: `/${ws}/stock` } : { label: "Add a product", href: `/${ws}/stock/new` }}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label={archived ? "Archived products" : "Products"}>
          {products.map((p) => {
            const state = stockState(p);
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link href={`/${ws}/stock/${p.id}`} className="min-w-0 flex-1 hover:text-primary">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {[p.sku, p.kind === "service" ? "Service" : null, p.supplierName].filter(Boolean).join(" · ") || " "}
                  </span>
                </Link>
                <span className="tabular-nums">{formatMoney(p.priceCents)}</span>
                {p.trackStock && (
                  <span
                    className={`min-w-24 text-right text-sm font-medium tabular-nums ${state === "oversold" || state === "out" ? "text-destructive" : ""}`}
                    aria-label={`${formatQty(p.stockQty)} in stock${STOCK_STATE_LABEL[state] && state !== "ok" ? `, ${STOCK_STATE_LABEL[state].toLowerCase()}` : ""}`}
                  >
                    {formatQty(p.stockQty)}
                    {state !== "ok" && <span className="block text-xs font-normal">{STOCK_STATE_LABEL[state]}</span>}
                  </span>
                )}
                {archived && canWrite && <RestoreButton slug={ws} id={p.id} what="product" name={p.name} />}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm">
        <Link href={archived ? `/${ws}/stock` : `/${ws}/stock?show=archived`} className="inline-flex min-h-11 items-center text-muted-foreground hover:text-foreground">
          {archived ? "Back to products" : "Show archived products"}
        </Link>
      </p>
    </div>
  );
}
