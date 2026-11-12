import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { BookingSwitch, OpeningHours, ServiceList } from "@/features/bookings/components/booking-setup";
import { getBookingSetup } from "@/features/bookings/queries";
import { siteUrl } from "@/lib/site-url";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Booking setup", robots: { index: false } };

export default function BookingSetupPage({ params }: PageProps<"/[ws]/settings/bookings">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Setup params={params} />
    </Suspense>
  );
}

async function Setup({ params }: { params: PageProps<"/[ws]/settings/bookings">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role !== "owner" && ctx.role !== "admin") notFound();
  const s = await getBookingSetup(ctx);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/work/bookings`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Bookings
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Booking setup</h1>
      <BookingSwitch slug={ws} enabled={s.enabled} link={`${siteUrl()}/book/${ws}`} />
      <ServiceList slug={ws} services={s.services} />
      <OpeningHours slug={ws} rules={s.rules} />
    </div>
  );
}
