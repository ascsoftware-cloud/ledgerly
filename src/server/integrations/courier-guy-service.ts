import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeConnection, loadConnection, type Connection } from "./connections";
import * as cg from "./courier-guy";
import { describeFailure, isTransient, requestJson } from "./http";
import type { JobOutcome } from "./job-types";

/**
 * Courier Guy calls. Callers (server actions) have already checked the person's role in the
 * workspace; every query here is also scoped by that workspace or the shipment's own connection.
 */

function call(conn: Connection, path: string, init: RequestInit = {}) {
  const base = cg.safeBaseUrl(conn.settings.base_url);
  return requestJson(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.secret ?? ""}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}

/** Checks a key before saving it: a rates call for a tiny parcel between two Gauteng codes. */
export async function testKey(
  apiKey: string,
  baseUrl: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await requestJson(`${cg.safeBaseUrl(baseUrl)}/rates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(
      cg.rateRequest({
        collection: {
          type: "business",
          company: "",
          street_address: "1 Church Street",
          local_area: "",
          city: "Pretoria",
          zone: "Gauteng",
          code: "0002",
          country: "ZA",
        },
        delivery: {
          type: "business",
          company: "",
          street_address: "1 Main Street",
          local_area: "",
          city: "Johannesburg",
          zone: "Gauteng",
          code: "2001",
          country: "ZA",
        },
        parcels: [
          {
            submitted_length_cm: 10,
            submitted_width_cm: 10,
            submitted_height_cm: 10,
            submitted_weight_kg: 1,
            parcel_description: "",
          },
        ],
      }),
    ),
  });
  if (res.status === 401 || res.status === 403)
    return { ok: false, message: "Courier Guy didn't accept that API key." };
  if (res.networkError)
    return { ok: false, message: "Couldn't reach Courier Guy. Try again in a moment." };
  // Any other answer (even "no rates for this route") means the key itself works.
  return { ok: true };
}

export async function quote(
  workspaceId: string,
  input: { collection: cg.ShipAddress; delivery: cg.ShipAddress; parcels: cg.Parcel[] },
): Promise<{ ok: true; rates: cg.Rate[] } | { ok: false; message: string }> {
  const conn = await activeConnection(workspaceId, "courier_guy");
  if (!conn?.secret) return { ok: false, message: "Connect Courier Guy first." };
  const res = await call(conn, "/rates", {
    method: "POST",
    body: JSON.stringify(cg.rateRequest(input)),
  });
  if (!res.ok) {
    console.error("Courier Guy rates failed", { status: res.status });
    return {
      ok: false,
      message:
        res.status === 401 || res.status === 403
          ? "Courier Guy refused the API key. Reconnect it."
          : describeFailure("Courier Guy", res),
    };
  }
  const rates = cg.parseRates(res.body);
  if (!rates.length)
    return { ok: false, message: "Courier Guy has no service for that route and parcel." };
  return { ok: true, rates };
}

const shipmentRow = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  connection_id: z.uuid(),
  document_id: z.uuid().nullable(),
  status: z.string(),
  collection_address: cg.addressSchema,
  delivery_address: cg.addressSchema,
  collection_contact: z.object({
    name: z.string(),
    email: z.string().default(""),
    mobile_number: z.string().default(""),
  }),
  delivery_contact: z.object({
    name: z.string(),
    email: z.string().default(""),
    mobile_number: z.string().default(""),
  }),
  parcels: z.array(cg.parcelSchema),
  service_level_code: z.string(),
  provider_shipment_id: z.string().nullable(),
  tracking_ref: z.string().nullable(),
  last_error: z.string().nullable(),
});

async function loadShipment(id: string, workspaceId?: string) {
  let q = createAdminClient()
    .from("shipments")
    .select(
      "id, workspace_id, connection_id, document_id, status, collection_address, delivery_address, collection_contact, delivery_contact, parcels, service_level_code, provider_shipment_id, tracking_ref, last_error",
    )
    .eq("id", id);
  if (workspaceId) q = q.eq("workspace_id", workspaceId);
  const { data } = await q.maybeSingle();
  const p = shipmentRow.safeParse(data);
  return p.success ? p.data : null;
}

/** Books a shipment recorded by start_shipment(). Safe to call twice: only a "booking" row is sent. */
export async function book(
  workspaceId: string,
  shipmentId: string,
): Promise<{ ok: true; trackingRef: string | null } | { ok: false; message: string }> {
  const s = await loadShipment(shipmentId, workspaceId);
  if (!s) return { ok: false, message: "That shipment doesn't exist." };
  if (s.status === "failed")
    return {
      ok: false,
      message: s.last_error ?? "That booking failed. Get prices again to start a new one.",
    };
  if (s.status !== "booking") return { ok: true, trackingRef: s.tracking_ref };
  const conn = await loadConnection(s.connection_id);
  if (!conn?.secret || conn.status !== "active" || conn.workspace_id !== workspaceId) {
    return { ok: false, message: "Courier Guy is no longer connected." };
  }
  let reference: string | null = null;
  if (s.document_id) {
    const { data } = await createAdminClient()
      .from("sales_documents")
      .select("number")
      .eq("id", s.document_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    reference = (data?.number as string | null) ?? null;
  }
  const res = await call(conn, "/shipments", {
    method: "POST",
    body: JSON.stringify(
      cg.shipmentRequest({
        collection: s.collection_address,
        delivery: s.delivery_address,
        collectionContact: s.collection_contact,
        deliveryContact: s.delivery_contact,
        parcels: s.parcels,
        serviceLevelCode: s.service_level_code,
        reference,
      }),
    ),
  });
  const parsed = res.ok ? cg.parseShipment(res.body) : null;
  const db = createAdminClient();
  if (!parsed) {
    // A timeout may still have booked it on Courier Guy's side: say so rather than invite a rebook.
    const message = res.networkError
      ? "Courier Guy didn't answer. Check your Courier Guy portal before booking again, in case it went through."
      : describeFailure("Courier Guy", res);
    await db.rpc("finish_shipment_booking", {
      p_shipment: s.id,
      p_ok: false,
      p_provider_id: null,
      p_tracking: null,
      p_provider_status: null,
      p_charged_cents: null,
      p_error: message,
    });
    return { ok: false, message };
  }
  await db.rpc("finish_shipment_booking", {
    p_shipment: s.id,
    p_ok: true,
    p_provider_id: parsed.id,
    p_tracking: parsed.trackingRef,
    p_provider_status: parsed.status,
    p_charged_cents: parsed.chargedCents,
    p_error: null,
  });
  return { ok: true, trackingRef: parsed.trackingRef };
}

/** A short-lived link to the waybill PDF. */
export async function waybill(workspaceId: string, shipmentId: string): Promise<string | null> {
  const s = await loadShipment(shipmentId, workspaceId);
  if (!s?.provider_shipment_id) return null;
  const conn = await loadConnection(s.connection_id);
  if (!conn?.secret || conn.workspace_id !== workspaceId) return null;
  const res = await call(conn, `/shipments/label?id=${encodeURIComponent(s.provider_shipment_id)}`);
  return res.ok ? cg.parseLabelUrl(res.body) : null;
}

/** Queue worker: refreshes one shipment's tracking. */
export async function track(shipmentId: string, connectionId: string): Promise<JobOutcome> {
  const s = await loadShipment(shipmentId);
  if (!s || s.connection_id !== connectionId) return { ok: true };
  if (!s.tracking_ref) return { ok: true };
  const conn = await loadConnection(connectionId);
  if (!conn?.secret || conn.status !== "active") return { ok: true };
  const res = await call(
    conn,
    `/tracking/shipments?tracking_reference=${encodeURIComponent(s.tracking_ref)}`,
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403)
      return { ok: false, error: "Courier Guy refused the API key. Reconnect it.", stop: true };
    return {
      ok: false,
      error: describeFailure("Courier Guy tracking", res),
      retryIn: res.retryAfter ?? undefined,
      transient: isTransient(res),
    };
  }
  const t = cg.parseTracking(res.body);
  if (!t)
    return { ok: false, error: "Courier Guy's tracking answer was not in the expected shape" };
  await createAdminClient().rpc("record_shipment_tracking", {
    p_shipment: s.id,
    p_status: t.status,
    p_provider_status: t.providerStatus,
    p_events: t.events,
  });
  return { ok: true };
}
