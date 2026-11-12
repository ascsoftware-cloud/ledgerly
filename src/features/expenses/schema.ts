import { z } from "zod";
import { parseDateZA, todaySAST } from "@/lib/dates";
import { parseAmount } from "@/lib/money";

export const EXPENSE_METHODS = { card: "Card", eft: "EFT", cash: "Cash", debit_order: "Debit order", other: "Other" } as const;
export type ExpenseMethod = keyof typeof EXPENSE_METHODS;

/** The 15% VAT inside a VAT-inclusive amount, in whole cents, halves rounded away from zero. */
export function vatFromInclusive(amountCents: number): number {
  return Math.floor((amountCents * 30 + 115) / 230);
}

export const expenseSchema = z
  .object({
    amount: z.string().transform((v, ctx) => {
      const c = parseAmount(v ?? "");
      if (c === null || c <= 0) {
        ctx.addIssue({ code: "custom", message: "Enter the amount, like 1 150 or 1150,00." });
        return z.NEVER;
      }
      return c;
    }),
    spentOn: z
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
          ctx.addIssue({ code: "custom", message: "The date cannot be in the future." });
          return z.NEVER;
        }
        return iso;
      }),
    supplier: z.string().trim().max(120, "Keep the supplier under 120 characters.").optional().default(""),
    categoryId: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        if (!z.uuid().safeParse(v).success) {
          ctx.addIssue({ code: "custom", message: "Choose a category from the list." });
          return z.NEVER;
        }
        return v;
      }),
    includesVat: z.string().optional(),
    method: z.enum(["card", "eft", "cash", "debit_order", "other"], { message: "How did you pay? Pick one." }),
    description: z.string().trim().max(300, "Keep the note under 300 characters.").optional().default(""),
    requestId: z.uuid(),
  })
  .transform((v) => ({
    amountCents: v.amount,
    vatCents: v.includesVat === "on" ? vatFromInclusive(v.amount) : 0,
    spentOn: v.spentOn,
    supplier: v.supplier,
    categoryId: v.categoryId,
    method: v.method,
    description: v.description,
    requestId: v.requestId,
  }));
export type ExpenseInput = z.output<typeof expenseSchema>;

export type Cadence = "weekly" | "monthly" | "yearly";
export const CADENCES: Record<Cadence, string> = { weekly: "Every week", monthly: "Every month", yearly: "Every year" };

/** The next date a repeating cost falls on. Months keep their anchor day (31 Jan → 28 Feb → 31 Mar). */
export function nextOccurrence(iso: string, cadence: Cadence, anchorDay: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  let next: Date;
  if (cadence === "weekly") next = new Date(Date.UTC(y, m - 1, d + 7));
  else {
    const first = new Date(Date.UTC(y, m - 1 + (cadence === "yearly" ? 12 : 1), 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(anchorDay, lastDay)));
  }
  return next.toISOString().slice(0, 10);
}

export const RECEIPT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
