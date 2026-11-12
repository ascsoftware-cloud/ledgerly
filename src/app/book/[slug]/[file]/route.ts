import { connection } from "next/server";
import { buildIcs } from "@/features/bookings/booking";
import { loadBookingByToken } from "@/features/bookings/public-data";

/** /book/<slug>/<token>.ics: the booking as a calendar event. The token is the only key. */
export async function GET(_req: Request, ctx: RouteContext<"/book/[slug]/[file]">) {
  await connection();
  const { file } = await ctx.params;
  if (!file.endsWith(".ics")) return new Response("Not found", { status: 404 });
  const b = await loadBookingByToken(file.slice(0, -4));
  if (!b || b.status !== "confirmed") return new Response("Not found", { status: 404 });
  const ics = buildIcs({
    uid: `${b.id}@ledgerly`,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    stamp: b.created_at,
    summary: `${b.service} with ${b.business}`,
    description: `Booked with ${b.business} through Ledgerly.`,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="booking.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}
