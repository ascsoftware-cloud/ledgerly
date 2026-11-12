import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { requestIp } from "@/features/sales/public-data";

const pageSchema = z.object({
  name: z.string(),
  services: z.array(
    z.object({ id: z.uuid(), name: z.string(), description: z.string().nullable(), duration_min: z.coerce.number(), price_cents: z.coerce.number() }),
  ),
});
export type BookingPage = z.infer<typeof pageSchema>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The public booking page for a business, at most 120 loads an hour per visitor. */
export async function loadBookingPage(slug: string): Promise<{ kind: "ok"; page: BookingPage } | { kind: "missing" } | { kind: "busy" }> {
  await connection();
  if (!SLUG.test(slug) || slug.length > 40) return { kind: "missing" };
  if (!(await rateLimit("public-ip", await requestIp(), 120, 3600))) return { kind: "busy" };
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("get_booking_page", { p_slug: slug });
  const parsed = pageSchema.safeParse(data);
  return parsed.success ? { kind: "ok", page: parsed.data } : { kind: "missing" };
}

export async function loadSlots(slug: string, serviceId: string, date: string): Promise<string[]> {
  if (!z.uuid().safeParse(serviceId).success || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("get_available_slots", { p_slug: slug, p_service: serviceId, p_date: date });
  return z.array(z.string()).catch([]).parse(data ?? []).map((s) => new Date(s).toISOString());
}

const icsSchema = z.object({
  id: z.uuid(),
  service: z.string(),
  business: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  status: z.enum(["confirmed", "cancelled"]),
  created_at: z.string(),
});
export type BookingSummary = z.infer<typeof icsSchema>;

export async function loadBookingByToken(token: string): Promise<BookingSummary | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("get_booking_ics", { p_token: token });
  const parsed = icsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
