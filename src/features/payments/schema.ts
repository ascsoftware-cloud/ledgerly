import { z } from "zod";
import { parseDateZA, todaySAST } from "@/lib/dates";
import { parseAmount } from "@/lib/money";

export const SA_BANKS = [
  "ABSA",
  "African Bank",
  "Capitec",
  "Discovery Bank",
  "FNB",
  "Investec",
  "Nedbank",
  "Standard Bank",
  "TymeBank",
  "Other",
] as const;

export const bankDetailsSchema = z.object({
  bank: z.enum(SA_BANKS, { message: "Choose your bank." }),
  account_holder: z.string().trim().min(2, "Who is the account in the name of?").max(80),
  account_number: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^\d{6,16}$/, "Account numbers are 6 to 16 digits.")),
  branch_code: z
    .string()
    .transform((v) => v.replace(/\s/g, ""))
    .pipe(z.string().regex(/^\d{6}$/, "Branch codes are 6 digits (universal codes work).")),
  account_type: z.enum(["Cheque", "Savings", "Business", "Transmission"]),
});
export type BankDetails = z.infer<typeof bankDetailsSchema>;

export const yocoSchema = z.object({
  secretKey: z
    .string()
    .trim()
    .regex(/^sk_(test|live)_[A-Za-z0-9]{10,200}$/, "Paste the secret key from Yoco (it starts with sk_test_ or sk_live_)."),
});

export const payfastSchema = z.object({
  merchantId: z.string().trim().regex(/^\d{6,12}$/, "The merchant ID is the number on your PayFast settings page."),
  merchantKey: z.string().trim().regex(/^[A-Za-z0-9]{8,40}$/, "Check the merchant key on your PayFast settings page."),
  passphrase: z.string().trim().max(100).optional().default(""),
  mode: z.enum(["test", "live"]),
});

export const stitchSchema = z.object({
  clientId: z.string().trim().regex(/^[A-Za-z0-9._-]{8,100}$/, "Paste the client ID Stitch gave you."),
  clientSecret: z
    .string()
    .trim()
    .min(16, "Paste the client secret Stitch gave you.")
    .max(500)
    .regex(/^\S+$/, "The client secret has no spaces."),
  webhookSecret: z
    .string()
    .trim()
    .max(220)
    .refine((v) => v === "" || /^whsec_[A-Za-z0-9+/=]{16,200}$/.test(v), "The webhook signing secret starts with whsec_.")
    .optional()
    .default(""),
  mode: z.enum(["test", "live"]),
});

export const manualPaymentSchema = z.object({
  amount: z
    .string()
    .transform((v, ctx) => {
      const c = parseAmount(v);
      if (c === null || c <= 0) {
        ctx.addIssue({ code: "custom", message: "Enter the amount paid, like 1 500 or 1500,00." });
        return z.NEVER;
      }
      return c;
    }),
  method: z.enum(["eft", "cash", "card", "other"]),
  paidOn: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return todaySAST();
      const iso = parseDateZA(v);
      if (!iso) {
        ctx.addIssue({ code: "custom", message: "Use a date like 31/01/2027." });
        return z.NEVER;
      }
      if (iso > todaySAST()) {
        ctx.addIssue({ code: "custom", message: "The payment date cannot be in the future." });
        return z.NEVER;
      }
      return iso;
    }),
  reference: z.string().trim().max(120).optional().default(""),
  requestId: z.uuid(),
});

export const PROOF_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
