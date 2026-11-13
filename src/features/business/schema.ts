import { z } from "zod";

/**
 * The business details an owner or admin can change. The name is shown in the app and on documents; VAT details
 * appear on invoices. A South African VAT number has 10 digits and starts with 4.
 */
export const businessSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your business name.").max(80, "Keep the name under 80 characters."),
    registration: z.string().trim().max(40, "Keep the registration number under 40 characters.").default(""),
    vatRegistered: z.boolean(),
    vatNumber: z.string().trim().max(40, "That VAT number is too long.").default(""),
  })
  .transform((v, ctx) => {
    const digits = v.vatNumber.replace(/\s+/g, "");
    if (v.vatRegistered && !/^4\d{9}$/.test(digits)) {
      ctx.addIssue({ code: "custom", path: ["vatNumber"], message: v.vatNumber ? "South African VAT numbers have 10 digits and start with 4." : "Enter your VAT number, or untick VAT registered." });
      return z.NEVER;
    }
    return { ...v, vatNumber: v.vatRegistered ? digits : "" };
  });

export type BusinessInput = z.infer<typeof businessSchema>;
