import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Truck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { RestoreButton } from "@/features/inventory/components/stock-tools";
import { StockSections } from "@/features/inventory/components/stock-sections";
import { listSuppliers } from "@/features/inventory/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Suppliers", robots: { index: false } };

export default function SuppliersPage({ params, searchParams }: PageProps<"/[ws]/stock/suppliers">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Suppliers params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Suppliers({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/stock/suppliers">["params"];
  searchParams: PageProps<"/[ws]/stock/suppliers">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  const archived = sp.show === "archived";
  const canWrite = ctx.role !== "accountant";
  const suppliers = await listSuppliers(ctx, archived);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
        {canWrite && (
          <Link href={`/${ws}/stock/suppliers/new`} className={buttonVariants({ size: "touch" })}>
            <Plus className="size-5" aria-hidden /> Add supplier
          </Link>
        )}
      </header>
      <StockSections slug={ws} current="suppliers" />
      {suppliers.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={archived ? "Nothing archived" : "No suppliers yet"}
          body={archived ? "Suppliers you archive are kept here." : "Add the people you buy from, then order stock from them in a few taps."}
          action={archived ? { label: "Back to suppliers", href: `/${ws}/stock/suppliers` } : { label: "Add a supplier", href: `/${ws}/stock/suppliers/new` }}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label={archived ? "Archived suppliers" : "Suppliers"}>
          {suppliers.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link href={`/${ws}/stock/suppliers/${s.id}`} className="min-w-0 flex-1 hover:text-primary">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block truncate text-sm text-muted-foreground">{[s.email, s.phone].filter(Boolean).join(" · ") || " "}</span>
              </Link>
              {archived && canWrite && <RestoreButton slug={ws} id={s.id} what="supplier" name={s.name} />}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        <Link href={archived ? `/${ws}/stock/suppliers` : `/${ws}/stock/suppliers?show=archived`} className="inline-flex min-h-11 items-center text-muted-foreground hover:text-foreground">
          {archived ? "Back to suppliers" : "Show archived suppliers"}
        </Link>
      </p>
    </div>
  );
}
