import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BookingInput } from "@/features/bookings/booking";

/**
 * Books a slot through the server-only database function. The caller must have rate-limited
 * the visitor first: this sends a confirmation email to the address given.
 */
export async function createBooking(slug: string, b: BookingInput): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const { data, error } = await createAdminClient().rpc("create_booking", {
    p_slug: slug,
    p_service: b.serviceId,
    p_starts_at: b.startsAt,
    p_name: b.name,
    p_email: b.email,
    p_phone: b.phone,
    p_notes: b.notes || null,
  });
  if (error) return { ok: false, message: error.code === "LDG03" ? error.message : "Couldn't make the booking. Try again." };
  const token = (data as { token?: unknown } | null)?.token;
  return typeof token === "string" ? { ok: true, token } : { ok: false, message: "Couldn't make the booking. Try again." };
}
