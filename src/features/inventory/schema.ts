import { z } from "zod";
import { parseAmount } from "@/lib/money";
import { parseQuantity } from "@/features/sales/schema";

/** "−3", "+5", "2,5" → a signed quantity with up to 4 decimals, never 0, at most 1 000 000. */
export function parseSignedQuantity(input: string): number | null {
  const s = input.trim().replace(/[−–]/g, "-").replace(",", ".");
  if (!/^[+-]?\d+(\.\d{1,4})?$/.test(s)) return null;
  const n = Number(s);
  return n !== 0 && Math.abs(n) <= 1_000_000 ? n : null;
}

/** 12 → "12", 2.5 → "2,5" (South African decimal comma, no trailing zeros). */
export function formatQty(n: number): string {
  return String(Number(n.toFixed(4))).replace(".", ",");
}

export type StockShape ={ trackStock: boolean; stockQty: number; reorderLevel: number };
export type StockState = "untracked" | "oversold" | "out" | "low" | "ok";

/** Oversold = below zero (sold what the count did not have). Low = at or under the re-order level. */
export function stockState(p: StockShape): StockState {
  if (!p.trackStock) return "untracked";
  if (p.stockQty < 0) return "oversold";
  if (p.stockQty === 0) return "out";
  if (p.reorderLevel > 0 && p.stockQty <= p.reorderLevel) return "low";
  return "ok";
}

export const STOCK_STATE_LABEL: Record<StockState, string> = {
  untracked: "",
  oversold: "Oversold",
  out: "Out of stock",
  low: "Low stock",
  ok: "In stock",
};

/** Tracked products that need re-ordering, the emptiest first. */
export function lowStock<T extends StockShape>(products: T[]): T[] {
  return products
    .filter((p) => {
      const s = stockState(p);
      return s === "oversold" || s === "out" || s === "low";
    })
    .filter((p) => p.reorderLevel > 0 || p.stockQty <= 0)
    .sort((a, b) => a.stockQty - b.stockQty);
}

export const ORDER_STATUS = { draft: "Draft", sent: "Sent", received: "Received", cancelled: "Cancelled" } as const;

export const MOVEMENT_LABEL: Record<string, string> = {
  initial: "Opening stock",
  adjustment: "Adjustment",
  purchase: "Received from supplier",
  sale: "Sold on an invoice",
  void: "Invoice voided",
};

const optionalAmount = (what: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return 0;
      const c = parseAmount(v);
      if (c === null || c < 0) {
        ctx.addIssue({ code: "custom", message: `Enter the ${what} like 60 or 60,50.` });
        return z.NEVER;
      }
      return c;
    });

const optionalUuid = (what: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!z.uuid().safeParse(v).success) {
        ctx.addIssue({ code: "custom", message: `Choose a ${what} from the list.` });
        return z.NEVER;
      }
      return v;
    });

export const productSchema = z
  .object({
    name: z.string().trim().min(1, "Name the product.").max(120, "Keep the name under 120 characters."),
    sku: z.string().trim().max(40, "Keep the SKU under 40 characters.").optional(),
    kind: z.enum(["product", "service"], { message: "Choose product or service." }).default("product"),
    cost: optionalAmount("cost"),
    price: optionalAmount("price"),
    vat: z.enum(["0", "15"], { message: "Choose 0% or 15% VAT." }).optional().default("0"),
    trackStock: z.string().optional(),
    reorderLevel: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v?.trim()) return 0;
        const q = parseQuantity(v);
        if (q === null) {
          ctx.addIssue({ code: "custom", message: "Enter the re-order level as a number, like 5." });
          return z.NEVER;
        }
        return q;
      }),
    supplierId: optionalUuid("supplier"),
    openingStock: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v?.trim()) return null;
        const q = parseQuantity(v);
        if (q === null) {
          ctx.addIssue({ code: "custom", message: "Opening stock must be a number above zero, like 12." });
          return z.NEVER;
        }
        return q;
      }),
  })
  .transform((v) => {
    const tracked = v.kind === "product" && v.trackStock === "on";
    return {
      name: v.name,
      sku: v.sku ? v.sku : null,
      kind: v.kind,
      costCents: v.cost,
      priceCents: v.price,
      vatRate: Number(v.vat) as 0 | 15,
      trackStock: tracked,
      reorderLevel: tracked ? v.reorderLevel : 0,
      supplierId: v.supplierId,
      openingStock: tracked ? v.openingStock : null,
    };
  });
export type ProductInput = z.output<typeof productSchema>;

export const supplierSchema = z.object({
  name: z.string().trim().min(1, "Enter the supplier's name.").max(120, "Keep the name under 120 characters."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "That email address doesn't look right."),
  phone: z
    .string()
    .trim()
    .max(30, "Keep the phone number under 30 characters.")
    .optional()
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .max(1000, "Keep the notes under 1000 characters.")
    .optional()
    .transform((v) => (v ? v : null)),
});
export type SupplierInput = z.output<typeof supplierSchema>;

export const adjustSchema = z.object({
  change: z.string().transform((v, ctx) => {
    const n = parseSignedQuantity(v ?? "");
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "Enter how many to add (5) or remove (-3)." });
      return z.NEVER;
    }
    return n;
  }),
  note: z
    .string()
    .trim()
    .max(200, "Keep the note under 200 characters.")
    .optional()
    .transform((v) => (v ? v : null)),
});
export type AdjustInput = z.output<typeof adjustSchema>;

export const poLineSchema = z.object({
  productId: z.uuid({ message: "Choose a product." }),
  quantity: z.string().transform((v, ctx) => {
    const q = parseQuantity(v ?? "");
    if (q === null) {
      ctx.addIssue({ code: "custom", message: "Enter how many, like 12." });
      return z.NEVER;
    }
    return q;
  }),
  unitCost: optionalAmount("cost"),
});
