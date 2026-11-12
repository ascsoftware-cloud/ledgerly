import { z } from "zod";
import { normalisePhone } from "@/lib/phone";

/** Blank strings become null, so optional fields are either a real value or nothing. */
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const contactInputSchema = z.object({
  name: z.string().trim().min(1, "Add a name.").max(120, "Keep the name under 120 characters."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, "That email doesn't look right."),
  phone: z
    .string()
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const n = normalisePhone(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message: "That phone number doesn't look right." });
        return z.NEVER;
      }
      return n;
    }),
  company: optional(120),
  address: optional(500),
});

export type ContactInput = z.infer<typeof contactInputSchema>;

/** One imported CSV row: the same rules as the form. */
export const importRowSchema = contactInputSchema;

export const IMPORT_FIELDS = ["name", "email", "phone", "company", "address"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const MAX_IMPORT_ROWS = 1000;
