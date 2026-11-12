"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { sendErrorMessage } from "@/features/sales/status";
import type { Rate } from "@/server/integrations/courier-guy";
import { book, quote, waybill } from "@/server/integrations/courier-guy-service";
import { courierSetup } from "./queries";
import { chosenRateSchema, shipmentInputSchema, type ShipmentInput } from "./schema";

type Bookable = Awaited<ReturnType<typeof requireWorkspace>>;

async function bookers(slug: string): Promise<Bookable | null> {
  const ctx = await requireWorkspace(slug);
  return ctx.role === "accountant" ? null : ctx;
}

function first(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Check the form.";
}

export async function quoteShipment(
  slug: string,
  input: ShipmentInput,
): Promise<{ ok: true; rates: Rate[] } | { ok: false; message: string }> {
  const parsed = shipmentInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: first(parsed.error) };
  const ctx = await bookers(slug);
  if (!ctx) return { ok: false, message: "Your role can't book couriers." };
  const setup = await courierSetup(ctx);
  if (!setup) return { ok: false, message: "Connect Courier Guy first (More → Apps)." };
  if (!setup.collection || !setup.contact)
    return {
      ok: false,
      message: "Add your collection address under More → Apps → Courier Guy first.",
    };
  return quote(ctx.workspace.id, {
    collection: setup.collection,
    delivery: parsed.data.delivery,
    parcels: parsed.data.parcels,
  });
}

export async function bookShipment(
  slug: string,
  documentId: string,
  requestId: string,
  input: ShipmentInput,
  rate: { code: string; name: string; cents: number },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (!z.uuid().safeParse(documentId).success || !z.uuid().safeParse(requestId).success)
    return { ok: false, message: "That invoice doesn't exist." };
  const parsed = shipmentInputSchema.safeParse(input);
  const chosen = chosenRateSchema.safeParse(rate);
  if (!parsed.success) return { ok: false, message: first(parsed.error) };
  if (!chosen.success) return { ok: false, message: "Choose a service first." };
  const ctx = await bookers(slug);
  if (!ctx) return { ok: false, message: "Your role can't book couriers." };
  const setup = await courierSetup(ctx);
  if (!setup?.collection || !setup.contact)
    return {
      ok: false,
      message: "Add your collection address under More → Apps → Courier Guy first.",
    };

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("start_shipment", {
    p_workspace: ctx.workspace.id,
    p_document: documentId,
    p_request: requestId,
    p_collection: setup.collection,
    p_delivery: parsed.data.delivery,
    p_collection_contact: setup.contact,
    p_delivery_contact: parsed.data.recipient,
    p_parcels: parsed.data.parcels,
    p_service_code: chosen.data.code,
    p_service_name: chosen.data.name,
    p_quoted_cents: chosen.data.cents,
  });
  if (error) return { ok: false, message: sendErrorMessage(error) };
  const started = data as { id?: string } | null;
  if (!started?.id) return { ok: false, message: "Couldn't start the booking." };
  const result = await book(ctx.workspace.id, started.id);
  revalidatePath(`/${slug}/money/${documentId}`);
  if (!result.ok) return result;
  return {
    ok: true,
    message: result.trackingRef ? `Booked. Waybill ${result.trackingRef}.` : "Booked.",
  };
}

export async function waybillLink(slug: string, shipmentId: string): Promise<string | null> {
  if (!z.uuid().safeParse(shipmentId).success) return null;
  const ctx = await requireWorkspace(slug);
  return waybill(ctx.workspace.id, shipmentId);
}
