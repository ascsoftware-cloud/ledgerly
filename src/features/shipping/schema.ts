import { z } from "zod";
import { addressSchema, contactSchema, parcelSchema } from "@/server/integrations/courier-guy";

export const shipmentInputSchema = z.object({
  delivery: addressSchema,
  recipient: contactSchema,
  parcels: z.array(parcelSchema).min(1, "Add a parcel.").max(20),
});
export type ShipmentInput = z.input<typeof shipmentInputSchema>;

export const chosenRateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().max(100),
  cents: z.number().int().min(0),
});
