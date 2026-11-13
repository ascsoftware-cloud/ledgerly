import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { isVatRegistered } from "@/features/expenses/queries";
import { ProductForm } from "@/features/inventory/components/product-form";
import { AdjustStock, ArchiveButton } from "@/features/inventory/components/stock-tools";
import { getProduct, listMovements, listSuppliers } from "@/features/inventory/queries";
import { formatQty, MOVEMENT_LABEL, STOCK_STATE_LABEL, stockState } from "@/features/inventory/schema";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Product", robots: { index: false } };

const rand = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export default function ProductPage({ params }: PageProps<"/[ws]/stock/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Product params={params} />
    </Suspense>
  );
}

async function Product({ params }: { params: PageProps<"/[ws]/stock/[id]">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const p = await getProduct(ctx, id);
  if (!p) notFound();
  const canWrite = ctx.role !== "accountant";
  const [movements, suppliers, vatRegistered] = await Promise.all([listMovements(ctx, p.id), listSuppliers(ctx), isVatRegistered(ctx)]);
  const state = stockState(p);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${ws}/stock`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Stock
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <p className="text-muted-foreground">
            {formatMoney(p.priceCents)}
            {p.sku ? ` · ${p.sku}` : ""}
            {p.archived ? " · Archived" : ""}
          </p>
        </div>
        {p.trackStock && (
          <p className="text-right">
            <span className="block text-3xl font-semibold tabular-nums">{formatQty(p.stockQty)}</span>
            <span className={`text-sm ${state === "ok" ? "text-muted-foreground" : state === "low" ? "" : "text-destructive"}`}>{STOCK_STATE_LABEL[state]}</span>
          </p>
        )}
      </header>

      {state === "oversold" && (
        <p role="status" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
          More has been sold than you counted. Check your stock, then correct it below.
        </p>
      )}

      {canWrite && p.trackStock && <AdjustStock slug={ws} productId={p.id} />}

      {canWrite ? (
        <ProductForm
          slug={ws}
          productId={p.id}
          suppliers={suppliers}
          vatRegistered={vatRegistered}
          initial={{
            name: p.name,
            sku: p.sku ?? "",
            kind: p.kind,
            cost: p.costCents ? rand(p.costCents) : "",
            price: p.priceCents ? rand(p.priceCents) : "",
            vat: p.vatRate === 15 ? "15" : "0",
            trackStock: p.trackStock,
            reorderLevel: p.reorderLevel ? formatQty(p.reorderLevel) : "",
            supplierId: p.supplierId ?? "",
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Your role can view stock but not change it.</p>
      )}

      {p.trackStock && (
        <section aria-labelledby="history-heading" className="rounded-2xl border bg-card p-5 shadow-card">
          <h2 id="history-heading" className="font-semibold">
            Stock history
          </h2>
          {movements.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No stock changes yet. Add your opening stock above.</p>
          ) : (
            <ul className="mt-2 divide-y text-sm" aria-label="Stock history">
              {movements.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {MOVEMENT_LABEL[m.reason] ?? m.reason}
                    {m.note ? ` · ${m.note}` : ""}
                    <span className="block text-muted-foreground">{formatDate(m.created_at.slice(0, 10))}</span>
                  </span>
                  <span className={`font-medium tabular-nums ${m.qty_change < 0 ? "" : "text-success"}`}>
                    {m.qty_change > 0 ? "+" : ""}
                    {formatQty(m.qty_change)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canWrite && !p.archived && <ArchiveButton slug={ws} id={p.id} what="product" name={p.name} />}
    </div>
  );
}
