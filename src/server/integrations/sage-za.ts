import { z } from "zod";
import type {
  AccountingContact,
  AccountingDocument,
  AccountingMapping,
  AccountingPayment,
} from "./accounting";
import { randsToCents } from "./http";

/**
 * Sage Business Cloud Accounting, South African edition (accounting.sageone.co.za, API 2.0.0).
 * A different product and API from Sage's UK/IE/CA accounting. Every call carries:
 *  - `apikey` (issued by Sage to the developer: ASC), as a query parameter,
 *  - `companyid` for company data, as a query parameter,
 *  - HTTP Basic auth with the Sage user's own login.
 * Limits: 5 000 requests per company per day; exceeding it blocks the user for 24 hours.
 * Field names below are from the API's help pages (TaxInvoice/Save, CustomerReceipt/Save,
 * Customer/Save, CommercialDocumentLine, PaymentMethod), read on 2026-11-12.
 */

export const SAGE_BASE = "https://accounting.sageone.co.za/api/2.0.0";

/** CommercialDocumentLineType: Item 0, Account 1. We post to a sales account, so 1. */
export const LINE_TYPE_ACCOUNT = 1;
/** PaymentMethod: Cash 1, Cheque 2, CreditCard 3, EFT 4. */
export function paymentMethod(method: string): number {
  if (method === "cash") return 1;
  if (method === "yoco" || method === "card") return 3;
  return 4;
}

export function sageUrl(
  path: string,
  apiKey: string,
  companyId: string | null,
  extra: Record<string, string> = {},
): string {
  const u = new URL(`${SAGE_BASE}/${path}`);
  u.searchParams.set("apikey", apiKey);
  if (companyId) u.searchParams.set("companyid", companyId);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

const results = <T extends z.ZodTypeAny>(item: T) =>
  z.union([z.object({ Results: z.array(item) }).transform((o) => o.Results), z.array(item)]);

export type Choice = { value: string; label: string; rate?: number };

export function companies(body: unknown): Choice[] {
  const p = results(z.object({ ID: z.number().int(), Name: z.string() })).safeParse(body);
  return p.success ? p.data.map((c) => ({ value: String(c.ID), label: c.Name })) : [];
}

export function accounts(body: unknown): Choice[] {
  const p = results(
    z.object({ ID: z.number().int(), Name: z.string(), Active: z.boolean().optional() }),
  ).safeParse(body);
  return p.success
    ? p.data.filter((a) => a.Active !== false).map((a) => ({ value: String(a.ID), label: a.Name }))
    : [];
}

export function bankAccounts(body: unknown): Choice[] {
  const p = results(
    z.object({ ID: z.number().int(), Name: z.string(), Active: z.boolean().optional() }),
  ).safeParse(body);
  return p.success
    ? p.data.filter((a) => a.Active !== false).map((a) => ({ value: String(a.ID), label: a.Name }))
    : [];
}

export function taxTypes(body: unknown): Choice[] {
  const p = results(
    z.object({
      ID: z.number().int(),
      Name: z.string(),
      Percentage: z.number().optional(),
      Active: z.boolean().optional(),
    }),
  ).safeParse(body);
  return p.success
    ? p.data
        .filter((t) => t.Active !== false)
        .map((t) => ({
          value: String(t.ID),
          label: `${t.Name}${t.Percentage !== undefined ? ` (${t.Percentage}%)` : ""}`,
          rate: t.Percentage,
        }))
    : [];
}

export function customerPayload(c: AccountingContact) {
  return {
    Name: c.name.slice(0, 100),
    ...(c.email ? { Email: c.email } : {}),
    ...(c.phone ? { Mobile: c.phone.slice(0, 30) } : {}),
    ...(c.vatNumber ? { TaxReference: c.vatNumber.slice(0, 30) } : {}),
    Active: true,
  };
}

/**
 * Account lines must have quantity 1, so each Ledgerly line becomes one account line for its
 * net amount, with the quantity and unit price kept in the description.
 */
export function documentPayload(d: AccountingDocument, customerId: number, m: AccountingMapping) {
  return {
    CustomerId: customerId,
    Date: d.issueDate,
    DueDate: d.dueDate ?? d.issueDate,
    Reference: d.number.slice(0, 100),
    Inclusive: false,
    Lines: d.lines.map((l) => {
      const qty = Number.isInteger(l.quantity) ? String(l.quantity) : l.quantity.toFixed(2);
      const prefix = l.quantity === 1 && !l.discountPct ? "" : `${qty} × `;
      const disc = l.discountPct ? ` (less ${l.discountPct}%)` : "";
      return {
        SelectionId: Number(m.salesAccount),
        LineType: LINE_TYPE_ACCOUNT,
        TaxTypeId: Number(l.vatRate === 15 ? m.taxStandard : (m.taxZero ?? m.taxStandard)),
        Description: `${prefix}${l.description}${disc}`.slice(0, 100),
        Quantity: 1,
        UnitPriceExclusive: l.netCents / 100,
      };
    }),
  };
}

export function receiptPayload(
  p: AccountingPayment,
  customerId: number,
  m: AccountingMapping,
  invoiceNumber: string,
) {
  return {
    CustomerId: customerId,
    Date: p.paidOn,
    Total: p.amountCents / 100,
    Reference: (p.reference || invoiceNumber).slice(0, 100),
    Description: `Payment for ${invoiceNumber}`.slice(0, 100),
    BankAccountId: Number(m.bankAccount),
    PaymentMethod: paymentMethod(p.method),
  };
}

export function savedId(
  body: unknown,
): { id: string; totalCents: number | null; number: string | null } | null {
  const p = z
    .object({
      ID: z.number().int(),
      Total: z.union([z.number(), z.string()]).optional(),
      DocumentNumber: z.string().nullish(),
    })
    .safeParse(body);
  if (!p.success) return null;
  return {
    id: String(p.data.ID),
    totalCents: p.data.Total === undefined ? null : randsToCents(p.data.Total),
    number: p.data.DocumentNumber ?? null,
  };
}

/** Sage blocks the username for 24 hours after too many requests: wait the longest the queue allows. */
export const RATE_LIMIT_RETRY_SECONDS = 3600;
