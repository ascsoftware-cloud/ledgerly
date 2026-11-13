import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CalendarPlus, CheckCircle2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { whenLabel } from "@/features/bookings/booking";
import { loadBookingByToken } from "@/features/bookings/public-data";

export const metadata: Metadata = { title: "You're booked", robots: { index: false, follow: false } };

export default function DonePage({ params, searchParams }: PageProps<"/book/[slug]/done">) {
  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-12">
      <Suspense fallback={<PageSkeleton variant="detail" />}>
        <Done params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Done({ params, searchParams }: { params: PageProps<"/book/[slug]/done">["params"]; searchParams: PageProps<"/book/[slug]/done">["searchParams"] }) {
  await connection();
  const { slug } = await params;
  const { t } = await searchParams;
  const b = typeof t === "string" ? await loadBookingByToken(t) : null;
  if (!b || b.status !== "confirmed") notFound();
  return (
    <section aria-label="Booking confirmed" className="space-y-4 rounded-2xl border bg-card p-6 text-center shadow-card">
      <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re booked</h1>
      <p>
        {b.service} with {b.business}
        <br />
        <strong>{whenLabel(b.starts_at)}</strong>
      </p>
      <p className="text-sm text-muted-foreground">
        A confirmation email is on its way{Date.parse(b.starts_at) - Date.parse(b.created_at) > 25 * 3600_000 ? ", and a reminder the day before" : ""}.
      </p>
      <a href={`/book/${slug}/${t}.ics`} className={buttonVariants({ variant: "outline", size: "touch" })}>
        <CalendarPlus className="size-5" aria-hidden /> Add to calendar
      </a>
    </section>
  );
}
