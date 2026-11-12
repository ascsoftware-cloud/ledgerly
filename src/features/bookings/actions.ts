"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/lib/money";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";

type Result = { ok: boolean; message?: string };

async function managers(slug: string) {
  const ctx = await requireWorkspace(slug);
  return ctx.role === "owner" || ctx.role === "admin" ? ctx : null;
}
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/settings/bookings`);
  revalidatePath(`/${slug}/work/bookings`);
};

export async function setBookingEnabled(slug: string, on: boolean): Promise<Result> {
  const ctx = await managers(slug);
  if (!ctx) return { ok: false, message: "Only owners and admins can change this." };
  const supabase = await createServerClient();
  const { error } = await supabase.from("workspace_settings").update({ booking_enabled: on === true }).eq("workspace_id", ctx.workspace.id);
  refresh(slug);
  return { ok: !error };
}

const serviceSchema = z.object({
  name: z.string().trim().min(1, "Name the service.").max(80),
  duration: z.coerce.number({ message: "How long does it take?" }).int().min(5, "At least 5 minutes.").max(480, "At most 8 hours."),
  buffer: z.coerce.number().int().min(0).max(240).optional().default(0),
  price: z
    .string()
    .optional()
    .transform((v, c) => {
      if (!v?.trim()) return 0;
      const cents = parseAmount(v);
      if (cents === null || cents < 0) {
        c.addIssue({ code: "custom", message: "Enter a price like 250 or 250,00, or leave it blank." });
        return z.NEVER;
      }
      return cents;
    }),
});

export type ServiceFormResult = { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

export async function addService(slug: string, _prev: ServiceFormResult, form: FormData): Promise<ServiceFormResult> {
  const parsed = serviceSchema.safeParse({
    name: form.get("name") ?? "",
    duration: form.get("duration") ?? "",
    buffer: form.get("buffer") || 0,
    price: form.get("price") ?? "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await managers(slug);
  if (!ctx) return { status: "error", message: "Only owners and admins can change services." };
  const supabase = await createServerClient();
  const { error } = await supabase.from("services").insert({
    workspace_id: ctx.workspace.id,
    name: parsed.data.name,
    duration_min: parsed.data.duration,
    buffer_min: parsed.data.buffer,
    price_cents: parsed.data.price,
  });
  if (error) return { status: "error", message: "Couldn't add the service." };
  refresh(slug);
  return { status: "saved" };
}

export async function setServiceActive(slug: string, serviceId: string, active: boolean): Promise<Result> {
  if (!z.uuid().safeParse(serviceId).success) return { ok: false };
  const ctx = await managers(slug);
  if (!ctx) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("services").update({ active: active === true }).eq("id", serviceId).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
  refresh(slug);
  return { ok: !!data };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export async function addOpeningHours(slug: string, weekday: number, start: string, end: string): Promise<Result> {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !TIME.test(start) || !TIME.test(end)) return { ok: false, message: "Choose a day and times like 08:00." };
  if (end <= start) return { ok: false, message: "Closing time must be after opening time." };
  const ctx = await managers(slug);
  if (!ctx) return { ok: false, message: "Only owners and admins can change opening hours." };
  const supabase = await createServerClient();
  const { error } = await supabase.from("availability_rules").insert({ workspace_id: ctx.workspace.id, weekday, start_time: start, end_time: end });
  refresh(slug);
  return error ? { ok: false, message: "Couldn't save those hours." } : { ok: true };
}

export async function removeOpeningHours(slug: string, ruleId: string): Promise<Result> {
  if (!z.uuid().safeParse(ruleId).success) return { ok: false };
  const ctx = await managers(slug);
  if (!ctx) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase.from("availability_rules").delete().eq("id", ruleId).eq("workspace_id", ctx.workspace.id).select("id");
  refresh(slug);
  return { ok: !!data?.length };
}

/** The team cancels a booking; its reminder is then dropped by the outbox worker. */
export async function cancelBooking(slug: string, bookingId: string): Promise<Result> {
  if (!z.uuid().safeParse(bookingId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (ctx.role === "accountant") return { ok: false, message: "Your role can view bookings but not change them." };
  const supabase = await createServerClient();
  const { data } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
  refresh(slug);
  return { ok: !!data };
}
