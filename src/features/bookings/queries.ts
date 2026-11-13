import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

const bookingRow = z.object({
  id: z.uuid(),
  starts_at: z.string(),
  ends_at: z.string(),
  customer_name: z.string(),
  customer_email: z.string(),
  customer_phone: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(["confirmed", "cancelled"]),
  contact_id: z.uuid().nullable(),
  services: z.object({ name: z.string() }).nullable(),
});
export type BookingRow = z.infer<typeof bookingRow>;

/** Bookings from today (SAST) for the next `days` days (the database allows bookings up to 60 days ahead), soonest first. */
export async function listUpcoming(ctx: WorkspaceContext, fromIso: string, days = 60): Promise<BookingRow[]> {
  const from = new Date(`${fromIso}T00:00:00+02:00`);
  const to = new Date(from.getTime() + days * 86_400_000);
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, customer_name, customer_email, customer_phone, notes, status, contact_id, services(name)")
    .eq("workspace_id", ctx.workspace.id)
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at")
    .limit(500);
  return z.array(bookingRow).catch([]).parse(data ?? []);
}

const serviceRow = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  duration_min: z.coerce.number(),
  buffer_min: z.coerce.number(),
  price_cents: z.coerce.number(),
  active: z.boolean(),
});
const ruleRow = z.object({ id: z.uuid(), weekday: z.coerce.number(), start_time: z.string(), end_time: z.string() });
export type ServiceRow = z.infer<typeof serviceRow>;
export type RuleRow = z.infer<typeof ruleRow>;

export async function getBookingSetup(ctx: WorkspaceContext): Promise<{ enabled: boolean; services: ServiceRow[]; rules: RuleRow[] }> {
  const supabase = await createServerClient();
  const [settings, services, rules] = await Promise.all([
    supabase.from("workspace_settings").select("booking_enabled").eq("workspace_id", ctx.workspace.id).maybeSingle(),
    supabase.from("services").select("id, name, description, duration_min, buffer_min, price_cents, active").eq("workspace_id", ctx.workspace.id).order("name"),
    supabase.from("availability_rules").select("id, weekday, start_time, end_time").eq("workspace_id", ctx.workspace.id).order("weekday").order("start_time"),
  ]);
  return {
    enabled: settings.data?.booking_enabled === true,
    services: z.array(serviceRow).catch([]).parse(services.data ?? []),
    rules: z.array(ruleRow).catch([]).parse(rules.data ?? []),
  };
}
