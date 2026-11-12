import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import { addressSchema, contactSchema } from "@/server/integrations/courier-guy";

const shipment = z.object({
  id: z.uuid(),
  status: z.enum(["booking", "booked", "in_transit", "delivered", "cancelled", "failed"]),
  provider_status: z.string().nullable(),
  service_level_name: z.string().nullable(),
  service_level_code: z.string(),
  quoted_cents: z.number().nullable(),
  charged_cents: z.number().nullable(),
  tracking_ref: z.string().nullable(),
  last_error: z.string().nullable(),
  created_at: z.string(),
  shipment_events: z.array(
    z.object({
      happened_at: z.string(),
      status: z.string(),
      message: z.string().nullable(),
      location: z.string().nullable(),
    }),
  ),
});
export type ShipmentView = z.infer<typeof shipment>;

export async function listShipments(
  ctx: WorkspaceContext,
  documentId: string,
): Promise<ShipmentView[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("shipments")
    .select(
      "id, status, provider_status, service_level_name, service_level_code, quoted_cents, charged_cents, tracking_ref, last_error, created_at, shipment_events(happened_at, status, message, location)",
    )
    .eq("workspace_id", ctx.workspace.id)
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  return z
    .array(shipment)
    .catch([])
    .parse(data ?? [])
    .map((s) => ({
      ...s,
      shipment_events: [...s.shipment_events].sort((a, b) =>
        b.happened_at.localeCompare(a.happened_at),
      ),
    }));
}

/** Whether Courier Guy is connected, and the saved collection address and contact. */
export async function courierSetup(ctx: WorkspaceContext) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("integration_connections")
    .select("id, settings")
    .eq("workspace_id", ctx.workspace.id)
    .eq("provider", "courier_guy")
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  const s = (data.settings ?? {}) as Record<string, unknown>;
  const collection = addressSchema.safeParse(s.collection);
  const contact = contactSchema.safeParse(s.collection_contact);
  return {
    connectionId: data.id as string,
    collection: collection.success ? collection.data : null,
    contact: contact.success ? contact.data : null,
  };
}
