import { z } from "zod";
import { parseDateZA } from "@/lib/dates";
import { parseAmount, type LineInput } from "@/lib/money";

export const KINDS = ["invoice", "quote", "credit_note"] as const;
export type Kind = (typeof KINDS)[number];

/** "1,5" or "1.5" → 1.5. Up to 4 decimal places, more than 0, at most 1 000 000. */
export function parseQuantity(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 1_000_000 ? n : null;
}

const rawLine = z.object({
  description: z.string().optional().default(""),
  quantity: z.string().optional().default(""),
  unitPrice: z.string().optional().default(""),
  discount: z.string().optional().default(""),
  vat: z.string().optional().default("0"),
  productId: z.string().optional().default(""),
});

export type DraftLine = { description: string; productId?: string } & LineInput;

function toLine(raw: z.infer<typeof rawLine>, ctx: z.RefinementCtx, index: number): DraftLine | null {
  const blank = !raw.description.trim() && !raw.quantity.trim() && !raw.unitPrice.trim();
  if (blank) return null;
  const fail = (message: string) => {
    ctx.addIssue({ code: "custom", path: [index], message });
    return null;
  };
  const description = raw.description.trim();
  if (!description) return fail(`Line ${index + 1}: describe what you're charging for.`);
  if (description.length > 500) return fail(`Line ${index + 1}: keep the description under 500 characters.`);
  const quantity = parseQuantity(raw.quantity || "1");
  if (quantity === null) return fail(`Line ${index + 1}: the quantity should be a number above 0.`);
  const unitCents = parseAmount(raw.unitPrice);
  if (unitCents === null || unitCents < 0) return fail(`Line ${index + 1}: enter a price, like 450 or 1 250,00.`);
  const discountPct = raw.discount.trim() ? Number(raw.discount.trim().replace(",", ".").replace("%", "")) : 0;
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    return fail(`Line ${index + 1}: the discount should be between 0 and 100%.`);
  }
  if (raw.vat !== "0" && raw.vat !== "15") return fail(`Line ${index + 1}: VAT is 0% or 15%.`);
  if (raw.productId && !z.uuid().safeParse(raw.productId).success) return fail(`Line ${index + 1}: choose the product from the list.`);
  return {
    description,
    quantity,
    unitCents,
    discountPct: Math.round(discountPct * 100) / 100,
    vatRate: raw.vat === "15" ? 15 : 0,
    productId: raw.productId || undefined,
  };
}

/** The editor form, as typed, turned into exactly what the database stores. */
export const draftSchema = z
  .object({
    kind: z.enum(KINDS),
    contactId: z.uuid("Choose who this is for."),
    dueDate: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v?.trim()) return null;
        const iso = parseDateZA(v);
        if (!iso) {
          ctx.addIssue({ code: "custom", message: "Use a date like 31/01/2027." });
          return z.NEVER;
        }
        return iso;
      }),
    notes: z
      .string()
      .max(2000, "Keep notes under 2 000 characters.")
      .optional()
      .transform((v) => (v?.trim() ? v.trim() : null)),
    depositType: z.enum(["none", "pct", "amount"]).optional().default("none"),
    depositValue: z.string().optional().default(""),
    lines: z.array(rawLine).max(200, "Up to 200 lines per document.").transform((rows, ctx) => {
      const out = rows.map((r, i) => toLine(r, ctx, i)).filter((l): l is DraftLine => l !== null);
      return out;
    }),
  })
  .transform((v, ctx) => {
    let deposit: { type: "pct" | "amount"; value: number } | null = null;
    if (v.depositType === "pct") {
      const pct = Number(v.depositValue.replace(",", ".").replace("%", ""));
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        ctx.addIssue({ code: "custom", path: ["depositValue"], message: "A deposit percentage is between 1 and 100." });
        return z.NEVER;
      }
      deposit = { type: "pct", value: pct };
    } else if (v.depositType === "amount") {
      const cents = parseAmount(v.depositValue);
      if (cents === null || cents <= 0) {
        ctx.addIssue({ code: "custom", path: ["depositValue"], message: "Enter the deposit in rand." });
        return z.NEVER;
      }
      deposit = { type: "amount", value: cents };
    }
    return { kind: v.kind, contactId: v.contactId, dueDate: v.dueDate, notes: v.notes, deposit, lines: v.lines };
  });

export type Draft = z.infer<typeof draftSchema>;
