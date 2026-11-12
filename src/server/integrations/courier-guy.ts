import { z } from "zod";
import { randsToCents } from "./http";

/**
 * Courier Guy runs on Ship Logic. Request and response shapes here follow Courier Guy's
 * published Ship Logic examples (docs/plans/integrations.md, "Courier Guy"). Courier Guy has
 * no sandbox-independent reference for every response field, so parsing is deliberately
 * tolerant and everything we rely on is checked with zod before use.
 */

export const DEFAULT_BASE_URL = "https://api.shiplogic.com";
/** Sandbox accounts are created at tcg-sandbox.shiplogic.com and use the same API host. */
export const SANDBOX_BASE_URL = "https://api.shiplogic.com";

export const PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
] as const;

export const addressSchema = z.object({
  type: z.enum(["residential", "business"]).default("business"),
  company: z.string().trim().max(100).optional().default(""),
  street_address: z.string().trim().min(3, "Enter the street address.").max(150),
  local_area: z.string().trim().max(100).optional().default(""),
  city: z.string().trim().min(2, "Enter the town or city.").max(100),
  zone: z.enum(PROVINCES, { message: "Choose the province." }),
  code: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Postal codes are 4 digits."),
  country: z.literal("ZA").default("ZA"),
});
export type ShipAddress = z.infer<typeof addressSchema>;

export const contactSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the contact's name.").max(100),
    email: z.union([z.literal(""), z.email("That email address does not look right.")]).default(""),
    mobile_number: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s()-]/g, ""))
      .pipe(
        z.union([
          z.literal(""),
          z.string().regex(/^(\+27|0)\d{9}$/, "Use a South African mobile number."),
        ]),
      )
      .default(""),
  })
  .refine((c) => c.email !== "" || c.mobile_number !== "", {
    message: "Add an email address or a mobile number.",
  });
export type ShipContact = z.infer<typeof contactSchema>;

export const parcelSchema = z.object({
  submitted_length_cm: z.coerce.number().positive("Enter the length.").max(300),
  submitted_width_cm: z.coerce.number().positive("Enter the width.").max(300),
  submitted_height_cm: z.coerce.number().positive("Enter the height.").max(300),
  submitted_weight_kg: z.coerce.number().positive("Enter the weight.").max(1000),
  parcel_description: z.string().trim().max(100).optional().default(""),
});
export type Parcel = z.infer<typeof parcelSchema>;

/** Drops empty optional fields: Ship Logic treats "" differently from a missing field. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null),
  ) as Partial<T>;
}

export function rateRequest(input: {
  collection: ShipAddress;
  delivery: ShipAddress;
  parcels: Parcel[];
  declaredValueCents?: number;
}) {
  return {
    collection_address: compact(input.collection),
    delivery_address: compact(input.delivery),
    parcels: input.parcels.map((p) => compact(p)),
    ...(input.declaredValueCents ? { declared_value: input.declaredValueCents / 100 } : {}),
  };
}

export function shipmentRequest(input: {
  collection: ShipAddress;
  delivery: ShipAddress;
  collectionContact: ShipContact;
  deliveryContact: ShipContact;
  parcels: Parcel[];
  serviceLevelCode: string;
  reference: string | null;
  instructions?: string;
}) {
  return {
    collection_address: compact(input.collection),
    collection_contact: compact(input.collectionContact),
    delivery_address: compact(input.delivery),
    delivery_contact: compact(input.deliveryContact),
    parcels: input.parcels.map((p) => compact(p)),
    service_level_code: input.serviceLevelCode,
    ...(input.reference ? { customer_reference: input.reference.slice(0, 50) } : {}),
    ...(input.instructions
      ? { special_instructions_delivery: input.instructions.slice(0, 200) }
      : {}),
  };
}

const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const c = randsToCents(v);
  if (c === null) {
    ctx.addIssue({ code: "custom", message: "not an amount" });
    return z.NEVER;
  }
  return c;
});

const rateItem = z.object({
  rate: money,
  rate_excluding_vat: money.optional(),
  service_level: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    code: z.string().min(1),
    name: z.string().optional().default(""),
    delivery_date_from: z.string().optional(),
    delivery_date_to: z.string().optional(),
  }),
});

export type Rate = {
  code: string;
  name: string;
  /** Including VAT, in cents. */
  cents: number;
  deliveryFrom: string | null;
  deliveryTo: string | null;
};

/** Accepts `{ rates: [...] }` or `{ result: { rates: [...] } }`; skips entries it cannot read. */
export function parseRates(body: unknown): Rate[] {
  const root = (body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(root.rates)
    ? root.rates
    : Array.isArray((root.result as Record<string, unknown> | undefined)?.rates)
      ? ((root.result as Record<string, unknown>).rates as unknown[])
      : [];
  const out: Rate[] = [];
  for (const item of list) {
    const r = rateItem.safeParse(item);
    if (!r.success) continue;
    out.push({
      code: r.data.service_level.code,
      name: r.data.service_level.name || r.data.service_level.code,
      cents: r.data.rate,
      deliveryFrom: r.data.service_level.delivery_date_from ?? null,
      deliveryTo: r.data.service_level.delivery_date_to ?? null,
    });
  }
  return out.sort((a, b) => a.cents - b.cents);
}

const shipmentResponse = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  short_tracking_reference: z.string().optional(),
  custom_tracking_reference: z.string().optional(),
  status: z.string().optional(),
  rate: money.optional(),
});

export function parseShipment(body: unknown) {
  const r = shipmentResponse.safeParse(body);
  if (!r.success) return null;
  return {
    id: r.data.id,
    trackingRef: r.data.short_tracking_reference || r.data.custom_tracking_reference || null,
    status: r.data.status ?? null,
    chargedCents: r.data.rate ?? null,
  };
}

/** The waybill endpoint answers with a link to a PDF, as a bare string or inside an object. */
export function parseLabelUrl(body: unknown): string | null {
  const candidate =
    typeof body === "string"
      ? body.trim().replace(/^"|"$/g, "")
      : body && typeof body === "object"
        ? ((body as Record<string, unknown>).url ?? (body as Record<string, unknown>).label_url)
        : null;
  return typeof candidate === "string" && /^https:\/\//.test(candidate) ? candidate : null;
}

export type OurStatus = "booked" | "in_transit" | "delivered" | "cancelled";

/** Ship Logic statuses are free-form slugs ("submitted", "collected", "in-transit", "delivered"...). */
export function mapStatus(providerStatus: string | null | undefined): OurStatus {
  const s = (providerStatus ?? "").toLowerCase();
  if (s.includes("cancel")) return "cancelled";
  if (s === "delivered" || s.endsWith("-delivered") || s === "pod-uploaded") return "delivered";
  if (
    /collected|transit|hub|out-for-delivery|at-destination|on-route|in-progress|delivery-assigned/.test(
      s,
    )
  )
    return "in_transit";
  return "booked";
}

const trackingEvent = z.object({
  date: z.string(),
  status: z.string(),
  message: z.string().nullish(),
  location: z.string().nullish(),
});
const trackingShipment = z.object({
  status: z.string().optional(),
  tracking_events: z.array(z.unknown()).optional().default([]),
});

export type Tracking = {
  status: OurStatus;
  providerStatus: string | null;
  events: { at: string; status: string; message: string | null; location: string | null }[];
};

/** Accepts the shipment at the top level or as the first of `shipments`. */
export function parseTracking(body: unknown): Tracking | null {
  const root = (body ?? {}) as Record<string, unknown>;
  const candidate = Array.isArray(root.shipments) ? root.shipments[0] : root;
  const s = trackingShipment.safeParse(candidate);
  if (!s.success) return null;
  const events: Tracking["events"] = [];
  for (const raw of s.data.tracking_events) {
    const e = trackingEvent.safeParse(raw);
    if (!e.success || Number.isNaN(Date.parse(e.data.date))) continue;
    events.push({
      at: new Date(e.data.date).toISOString(),
      status: e.data.status,
      message: e.data.message ?? null,
      location: e.data.location ?? null,
    });
  }
  return { status: mapStatus(s.data.status), providerStatus: s.data.status ?? null, events };
}

/** Courier Guy only accepts https base URLs on Ship Logic or Courier Guy domains. */
export function safeBaseUrl(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_BASE_URL;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return DEFAULT_BASE_URL;
    if (!/(^|\.)shiplogic\.com$|(^|\.)thecourierguy\.co\.za$/.test(u.hostname))
      return DEFAULT_BASE_URL;
    return `https://${u.hostname}`;
  } catch {
    return DEFAULT_BASE_URL;
  }
}
