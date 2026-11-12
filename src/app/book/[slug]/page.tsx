import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { slotLabel, whenLabel } from "@/features/bookings/booking";
import { BookForm } from "@/features/bookings/components/book-form";
import { loadBookingPage, loadSlots } from "@/features/bookings/public-data";
import { todaySAST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Book a time", robots: { index: false, follow: false } };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export default function BookPage({ params, searchParams }: PageProps<"/book/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <Suspense fallback={<PageSkeleton variant="detail" />}>
        <Book params={params} searchParams={searchParams} />
      </Suspense>
      <p className="pt-4 text-center text-xs text-muted-foreground">Bookings by Ledgerly</p>
    </main>
  );
}

async function Book({ params, searchParams }: { params: PageProps<"/book/[slug]">["params"]; searchParams: PageProps<"/book/[slug]">["searchParams"] }) {
  const { slug } = await params;
  const sp = await searchParams;
  const res = await loadBookingPage(slug);
  if (res.kind === "busy") return <p role="alert">Too many requests from your connection. Try again in a few minutes.</p>;
  if (res.kind === "missing") notFound();
  const { page } = res;
  const today = todaySAST();
  const service = page.services.find((s) => s.id === sp.service);
  const date = service && typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date >= today ? sp.date : null;
  const slots = service && date ? await loadSlots(slug, service.id, date) : [];
  const time = typeof sp.time === "string" && slots.includes(sp.time) ? sp.time : null;
  const href = (q: Record<string, string>) => `/book/${slug}?${new URLSearchParams(q).toString()}`;
  const chip = "flex min-h-11 items-center justify-center rounded-xl border px-3 text-sm font-medium hover:bg-muted aria-[current=true]:border-primary aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground";

  return (
    <>
      <header>
        <p className="text-sm text-muted-foreground">Book a time with</p>
        <h1 className="text-2xl font-semibold tracking-tight">{page.name}</h1>
      </header>

      {page.services.length === 0 ? (
        <p role="status" className="rounded-xl border bg-muted px-4 py-3">
          There is nothing to book right now. Contact {page.name} directly.
        </p>
      ) : (
        <section aria-label="1. Choose a service" className="space-y-2">
          <h2 className="font-semibold">1. Choose a service</h2>
          <ul className="grid gap-2">
            {page.services.map((s) => (
              <li key={s.id}>
                <Link href={href({ service: s.id })} aria-current={s.id === service?.id} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 hover:bg-muted aria-[current=true]:border-primary aria-[current=true]:ring-2 aria-[current=true]:ring-primary">
                  <span>
                    <span className="block font-medium">{s.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {s.duration_min} min{s.description ? ` · ${s.description}` : ""}
                    </span>
                  </span>
                  {s.price_cents > 0 && <span className="font-medium tabular-nums">{formatMoney(s.price_cents)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {service && (
        <section aria-label="2. Choose a day" className="space-y-2">
          <h2 className="font-semibold">2. Choose a day</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
            {Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((d) => (
              <Link key={d} href={href({ service: service.id, date: d })} aria-current={d === date} className={chip}>
                {i18nDay(d, today)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {service && date && (
        <section aria-label="3. Choose a time" className="space-y-2">
          <h2 className="font-semibold">3. Choose a time on {dayLabel(date)}</h2>
          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No times left on this day. Try another day.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {slots.map((s) => (
                <Link key={s} href={href({ service: service.id, date, time: s })} aria-current={s === time} className={chip}>
                  {slotLabel(s)}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {service && time && (
        <section aria-label="4. Your details" className="space-y-2">
          <h2 className="font-semibold">4. Your details</h2>
          <p className="text-sm text-muted-foreground">
            {service.name}, {whenLabel(time)} ({service.duration_min} min)
          </p>
          <BookForm slug={slug} serviceId={service.id} startsAt={time} />
        </section>
      )}
    </>
  );
}

function i18nDay(d: string, today: string): string {
  if (d === today) return "Today";
  if (d === addDays(today, 1)) return "Tomorrow";
  return dayLabel(d);
}
