import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Settings, Truck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { WaybillButton } from "@/features/shipping/components/waybill-button";
import { courierSetup, listAllShipments, type ShipmentListRow } from "@/features/shipping/queries";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Courier", robots: { index: false } };

const STATUS: Record<ShipmentListRow["status"], string> = {
  booking: "Booking…",
  booked: "Booked",
  in_transit: "On its way",
  delivered: "Delivered",
  cancelled: "Cancelled",
  failed: "Booking failed",
};
const FILTERS = [
  { key: "open", label: "On the way" },
  { key: "delivered", label: "Delivered" },
  { key: "problems", label: "Problems" },
  { key: "all", label: "All" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

export default function CourierPage({ params, searchParams }: PageProps<"/[ws]/courier">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Courier params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Courier({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/courier">["params"];
  searchParams: PageProps<"/[ws]/courier">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  const manager = ctx.role === "owner" || ctx.role === "admin";
  const [setup, all] = await Promise.all([courierSetup(ctx), listAllShipments(ctx)]);

  if (!setup && all.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Courier</h1>
        <EmptyState
          icon={Truck}
          title="Courier Guy isn't connected"
          body={
            manager
              ? "Connect your Courier Guy account to get prices, book collections and track parcels from your invoices."
              : "Ask an owner or admin to connect Courier Guy."
          }
          action={
            manager
              ? { label: "Connect Courier Guy", href: `/${ws}/settings/integrations` }
              : { label: "Back to home", href: `/${ws}` }
          }
        />
      </div>
    );
  }

  const filter: Filter = FILTERS.some((f) => f.key === sp.filter) ? (sp.filter as Filter) : "open";
  const open = all.filter(
    (s) => s.status === "booked" || s.status === "in_transit" || s.status === "booking",
  );
  const delivered = all.filter((s) => s.status === "delivered");
  const problems = all.filter((s) => s.status === "failed" || s.status === "cancelled");
  const shown = { open, delivered, problems, all }[filter];
  const counts: Record<Filter, number> = {
    open: open.length,
    delivered: delivered.length,
    problems: problems.length,
    all: all.length,
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Courier</h1>
          <p className="text-sm text-muted-foreground">
            Book a collection from any sent invoice. Tracking updates every 30 minutes.
          </p>
        </div>
        {manager && (
          <Link
            href={`/${ws}/settings/integrations`}
            className={buttonVariants({ variant: "outline", size: "touch" })}
          >
            <Settings className="size-4" aria-hidden /> Courier Guy settings
          </Link>
        )}
      </header>
      {setup && (!setup.collection || !setup.contact) && (
        <p role="status" className="rounded-xl bg-accent px-4 py-3 text-sm">
          Add your collection address in Courier Guy settings before booking.
        </p>
      )}

      <nav
        aria-label="Filter shipments"
        className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1"
      >
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/${ws}/courier${f.key === "open" ? "" : `?filter=${f.key}`}`}
            aria-current={filter === f.key ? "page" : undefined}
            className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap text-muted-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
          >
            {f.label} <span className="tabular-nums">{counts[f.key]}</span>
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter === "open"
            ? "Nothing on the way. Open a sent invoice and choose Book Courier Guy."
            : "Nothing here."}
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card">
          {shown.map((s) => {
            const last = s.shipment_events[0];
            return (
              <li key={s.id} className="space-y-1 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {STATUS[s.status]} · {s.delivery_contact.name ?? "Recipient"}
                    {s.delivery_address.city && (
                      <span className="text-muted-foreground"> · {s.delivery_address.city}</span>
                    )}
                  </p>
                  <span className="flex items-center gap-2">
                    {(s.charged_cents ?? s.quoted_cents) !== null && (
                      <span className="tabular-nums">
                        {formatMoney((s.charged_cents ?? s.quoted_cents)!)}
                      </span>
                    )}
                    {s.tracking_ref && s.status !== "failed" && (
                      <WaybillButton slug={ws} shipmentId={s.id} />
                    )}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {new Date(s.created_at).toLocaleDateString("en-ZA")} ·{" "}
                  {s.service_level_name ?? s.service_level_code}
                  {s.tracking_ref && ` · waybill ${s.tracking_ref}`}
                  {s.document_id && s.sales_documents?.number && (
                    <>
                      {" · "}
                      <Link
                        href={`/${ws}/money/${s.document_id}`}
                        className="text-primary hover:underline"
                      >
                        {s.sales_documents.number}
                      </Link>
                    </>
                  )}
                </p>
                {s.last_error && <p className="text-destructive">{s.last_error}</p>}
                {last && (
                  <p className="text-muted-foreground">
                    {new Date(last.happened_at).toLocaleString("en-ZA")}:{" "}
                    {last.message ?? last.status}
                    {last.location ? `, ${last.location}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
