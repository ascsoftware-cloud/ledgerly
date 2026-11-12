import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock, Settings } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { slotLabel, whenLabel } from "@/features/bookings/booking";
import { CancelBooking } from "@/features/bookings/components/booking-setup";
import { listUpcoming } from "@/features/bookings/queries";
import { WorkTabs } from "@/features/work/components/work-tabs";
import { todaySAST } from "@/lib/dates";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Bookings", robots: { index: false } };

export default function BookingsPage({ params }: PageProps<"/[ws]/work/bookings">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Bookings params={params} />
    </Suspense>
  );
}

async function Bookings({ params }: { params: PageProps<"/[ws]/work/bookings">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const today = todaySAST();
  const rows = await listUpcoming(ctx, today, 30);
  const canWrite = ctx.role !== "accountant";
  const canSetUp = ctx.role === "owner" || ctx.role === "admin";
  const days = new Map<string, typeof rows>();
  for (const b of rows) {
    const day = whenLabel(b.starts_at).split(",")[0] ?? "";
    days.set(day, [...(days.get(day) ?? []), b]);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Work</h1>
        {canSetUp && (
          <Link href={`/${ws}/settings/bookings`} className={buttonVariants({ variant: "outline", size: "touch" })}>
            <Settings className="size-5" aria-hidden /> Booking setup
          </Link>
        )}
      </header>
      <WorkTabs slug={ws} current="bookings" />
      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No bookings in the next 30 days"
          body="Share your booking page and clients can pick a time that suits them, any time of day."
          action={canSetUp ? { label: "Set up bookings", href: `/${ws}/settings/bookings` } : { label: "Back to tasks", href: `/${ws}/work` }}
        />
      ) : (
        [...days].map(([day, list]) => (
          <section key={day} aria-label={day} className="space-y-2">
            <h2 className="font-semibold">{day}</h2>
            <ul className="divide-y rounded-2xl border bg-card shadow-card">
              {list.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3" aria-label={`${slotLabel(b.starts_at)} ${b.customer_name}`}>
                  <span className="w-24 font-medium tabular-nums">
                    {slotLabel(b.starts_at)}–{slotLabel(b.ends_at)}
                  </span>
                  <span className={`min-w-0 flex-1 ${b.status === "cancelled" ? "text-muted-foreground line-through" : ""}`}>
                    <span className="block truncate font-medium">
                      {b.contact_id ? <Link href={`/${ws}/clients/${b.contact_id}`} className="hover:underline">{b.customer_name}</Link> : b.customer_name}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {[b.services?.name, b.customer_phone ?? b.customer_email, b.notes].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {b.status === "cancelled" ? (
                    <span className="text-sm text-muted-foreground">Cancelled</span>
                  ) : (
                    canWrite && <CancelBooking slug={ws} id={b.id} label={`${b.customer_name} at ${slotLabel(b.starts_at)}`} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
