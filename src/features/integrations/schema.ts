import { z } from "zod";
import { addressSchema, contactSchema } from "@/server/integrations/courier-guy";

export const courierGuyConnectSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(16, "Paste the API key from your Courier Guy (Ship Logic) portal.")
    .max(500)
    .regex(/^\S+$/, "The API key has no spaces."),
  mode: z.enum(["test", "live"]),
});

/** Where parcels are collected from by default, prefilled on every booking. */
export const courierDefaultsSchema = z.object({
  collection: addressSchema,
  contact: contactSchema,
});

export const sageConnectSchema = z.object({
  username: z.email("Use the email address you sign in to Sage with.").max(254),
  password: z.string().min(1, "Enter your Sage password.").max(200),
  companyId: z
    .string()
    .regex(/^\d{1,12}$/)
    .optional(),
});

const choice = z.string().trim().max(100).optional().default("");
export const mappingSchema = z.object({
  sales_account: choice,
  bank_account: choice,
  tax_standard: choice,
  tax_zero: choice,
});

export const lowStockSchema = z.object({
  low_stock: z.coerce.number().int().min(0, "Use 0 or more.").max(100000),
});
