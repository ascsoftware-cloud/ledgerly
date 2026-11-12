"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { rateLimit } from "@/lib/rate-limit";
import { requestIp } from "@/features/sales/public-data";
import { createBooking } from "@/server/bookings/create";
import { runOutbox } from "@/server/jobs/run-outbox";
import { bookingSchema } from "./booking";

export type BookState = { status: "idle" } | { status: "error"; message: string };

/** A visitor books a slot. Rate-limited per IP; the database re-checks the slot and caps abuse. */
export async function bookSlot(slug: string, _prev: BookState, form: FormData): Promise<BookState> {
  const parsed = bookingSchema.safeParse({
    serviceId: form.get("serviceId"),
    startsAt: form.get("startsAt"),
    name: form.get("name") ?? "",
    email: form.get("email") ?? "",
    phone: form.get("phone") ?? "",
    notes: form.get("notes") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  if (!(await rateLimit("book-ip", await requestIp(), 10, 3600))) {
    return { status: "error", message: "Too many bookings from your connection. Try again later." };
  }
  const r = await createBooking(slug, parsed.data);
  if (!r.ok) return { status: "error", message: r.message };
  after(() => runOutbox().catch(() => undefined));
  redirect(`/book/${slug}/done?t=${r.token}`);
}
