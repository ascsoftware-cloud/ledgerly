import { z } from "zod";
import type {
  AccountingDocument,
  AccountingLine,
  AccountingMapping,
  AccountingPayment,
  AccountingContact,
} from "./accounting";
import { randsToCents } from "./http";

/**
 * Xero: OAuth 2.0 authorization code flow and the Accounting API payloads we send.
 * Apps created on or after 2 March 2026 only get granular scopes (accounting.invoices,
 * accounting.payments, ...); asking for accounting.transactions fails with invalid_scope.
 * Access tokens last 30 minutes; refresh tokens rotate on use and expire after 60 days unused.
 */

export const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
export const XERO_REVOKE_URL = "https://identity.xero.com/connect/revocation";
export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
export const XERO_API = "https://api.xero.com/api.xro/2.0";

export const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.contacts",
  "accounting.settings.read",
  "accounting.invoices",
  "accounting.payments",
] as const;

export function authorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL(XERO_AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", input.clientId);
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("scope", XERO_SCOPES.join(" "));
  u.searchParams.set("state", input.state);
  return u.toString();
}

export function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export const tokenResponse = z.object({
  access_token: z.string().min(10),
  refresh_token: z.string().min(10),
  expires_in: z.number().int().positive(),
});

const connection = z.object({
  id: z.string(),
  tenantId: z.string(),
  tenantType: z.string(),
  tenantName: z.string().nullable().optional(),
  updatedDateUtc: z.string().nullable().optional(),
  createdDateUtc: z.string().nullable().optional(),
});

/** The organisation just authorised: Xero lists every tenant the user ever authorised, newest last. */
export function pickTenant(
  body: unknown,
): { connectionId: string; tenantId: string; name: string } | null {
  const list = z.array(connection).safeParse(body);
  if (!list.success) return null;
  const orgs = list.data.filter((c) => c.tenantType === "ORGANISATION");
  if (!orgs.length) return null;
  const when = (c: z.infer<typeof connection>) =>
    Date.parse(c.updatedDateUtc ?? c.createdDateUtc ?? "") || 0;
  const best = orgs.reduce((a, b) => (when(b) >= when(a) ? b : a));
  return {
    connectionId: best.id,
    tenantId: best.tenantId,
    name: best.tenantName ?? "Xero organisation",
  };
}

// ---------------------------------------------------------------------------
// Settings lists for the mapping screen
// ---------------------------------------------------------------------------
const account = z.object({
  AccountID: z.string(),
  Code: z.string().nullable().optional(),
  Name: z.string(),
  Type: z.string(),
  Status: z.string().optional(),
});
const taxRate = z.object({
  Name: z.string(),
  TaxType: z.string(),
  EffectiveRate: z.union([z.number(), z.string()]).optional(),
  Status: z.string().optional(),
  CanApplyToRevenue: z.boolean().optional(),
});

export type Choice = { value: string; label: string; rate?: number };

export function salesAccounts(body: unknown): Choice[] {
  const list = z.object({ Accounts: z.array(account) }).safeParse(body);
  if (!list.success) return [];
  return list.data.Accounts.filter(
    (a) =>
      (a.Status ?? "ACTIVE") === "ACTIVE" &&
      ["REVENUE", "SALES", "OTHERINCOME"].includes(a.Type) &&
      a.Code,
  ).map((a) => ({ value: a.Code!, label: `${a.Code} · ${a.Name}` }));
}

export function bankAccounts(body: unknown): Choice[] {
  const list = z.object({ Accounts: z.array(account) }).safeParse(body);
  if (!list.success) return [];
  return list.data.Accounts.filter(
    (a) => (a.Status ?? "ACTIVE") === "ACTIVE" && a.Type === "BANK",
  ).map((a) => ({
    value: a.AccountID,
    label: a.Code ? `${a.Code} · ${a.Name}` : a.Name,
  }));
}

export function salesTaxRates(body: unknown): Choice[] {
  const list = z.object({ TaxRates: z.array(taxRate) }).safeParse(body);
  if (!list.success) return [];
  return list.data.TaxRates.filter(
    (t) => (t.Status ?? "ACTIVE") === "ACTIVE" && t.CanApplyToRevenue !== false,
  ).map((t) => ({
    value: t.TaxType,
    label: `${t.Name}${t.EffectiveRate !== undefined ? ` (${Number(t.EffectiveRate)}%)` : ""}`,
    rate: t.EffectiveRate !== undefined ? Number(t.EffectiveRate) : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------
const rands = (cents: number) => Math.round(cents) / 100;

export function contactPayload(c: AccountingContact) {
  return {
    Contacts: [
      {
        Name: c.name.slice(0, 255),
        ...(c.email ? { EmailAddress: c.email } : {}),
        ...(c.vatNumber ? { TaxNumber: c.vatNumber.slice(0, 50) } : {}),
        ...(c.phone
          ? { Phones: [{ PhoneType: "MOBILE", PhoneNumber: c.phone.slice(0, 50) }] }
          : {}),
      },
    ],
  };
}

function lineItem(l: AccountingLine, m: AccountingMapping) {
  const taxType = l.vatRate === 15 ? m.taxStandard : (m.taxZero ?? m.taxStandard);
  return {
    Description: l.description.slice(0, 4000),
    Quantity: l.quantity,
    UnitAmount: l.unitCents / 100,
    ...(l.discountPct ? { DiscountRate: l.discountPct } : {}),
    AccountCode: m.salesAccount,
    TaxType: taxType,
    // Ledgerly's VAT per line, so Xero's rounding cannot drift from the invoice the client got.
    TaxAmount: rands(l.vatCents),
  };
}

export function documentPayload(d: AccountingDocument, contactId: string, m: AccountingMapping) {
  const common = {
    Contact: { ContactID: contactId },
    Date: d.issueDate,
    LineAmountTypes: "Exclusive",
    Status: "AUTHORISED",
    CurrencyCode: "ZAR",
    LineItems: d.lines.map((l) => lineItem(l, m)),
  };
  if (d.kind === "credit_note") {
    return {
      CreditNotes: [
        { Type: "ACCRECCREDIT", CreditNoteNumber: d.number, Reference: d.number, ...common },
      ],
    };
  }
  return {
    Invoices: [
      {
        Type: "ACCREC",
        InvoiceNumber: d.number,
        Reference: d.number,
        DueDate: d.dueDate ?? d.issueDate,
        ...common,
      },
    ],
  };
}

export function voidPayload(kind: "invoice" | "credit_note", externalId: string) {
  return kind === "credit_note"
    ? { CreditNotes: [{ CreditNoteID: externalId, Status: "VOIDED" }] }
    : { Invoices: [{ InvoiceID: externalId, Status: "VOIDED" }] };
}

export function paymentPayload(p: AccountingPayment, invoiceId: string, m: AccountingMapping) {
  return {
    Payments: [
      {
        Invoice: { InvoiceID: invoiceId },
        Account: { AccountID: m.bankAccount },
        Date: p.paidOn,
        Amount: rands(p.amountCents),
        Reference: (p.reference || `Ledgerly ${p.method}`).slice(0, 255),
      },
    ],
  };
}

export function allocationPayload(invoiceId: string, amountCents: number, date: string) {
  return {
    Allocations: [{ Invoice: { InvoiceID: invoiceId }, Amount: rands(amountCents), Date: date }],
  };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
export function createdContactId(body: unknown): string | null {
  const p = z
    .object({ Contacts: z.array(z.object({ ContactID: z.string() })).min(1) })
    .safeParse(body);
  return p.success ? p.data.Contacts[0]!.ContactID : null;
}

/** Contacts?searchTerm= returns partial matches; keep only an exact (case-insensitive) name. */
export function findContactByName(body: unknown, name: string): string | null {
  const p = z
    .object({ Contacts: z.array(z.object({ ContactID: z.string(), Name: z.string() })) })
    .safeParse(body);
  if (!p.success) return null;
  const want = name.trim().toLowerCase();
  return p.data.Contacts.find((c) => c.Name.trim().toLowerCase() === want)?.ContactID ?? null;
}

export function isDuplicateContactName(body: unknown): boolean {
  return JSON.stringify(body ?? "")
    .toLowerCase()
    .includes("already assigned to another contact");
}

export function createdDocument(body: unknown, kind: "invoice" | "credit_note") {
  const key = kind === "credit_note" ? "CreditNotes" : "Invoices";
  const idKey = kind === "credit_note" ? "CreditNoteID" : "InvoiceID";
  const numKey = kind === "credit_note" ? "CreditNoteNumber" : "InvoiceNumber";
  const list = (body as Record<string, unknown> | null)?.[key];
  const first = Array.isArray(list) ? (list[0] as Record<string, unknown> | undefined) : undefined;
  if (!first || typeof first[idKey] !== "string") return null;
  return {
    id: first[idKey] as string,
    number: typeof first[numKey] === "string" ? (first[numKey] as string) : null,
    totalCents: randsToCents(first.Total),
  };
}

export function createdPaymentId(body: unknown): string | null {
  const p = z
    .object({ Payments: z.array(z.object({ PaymentID: z.string() })).min(1) })
    .safeParse(body);
  return p.success ? p.data.Payments[0]!.PaymentID : null;
}

/** Xero's Idempotency-Key header is limited to 128 characters. */
export function idempotencyKey(parts: string[]): string {
  return parts.join(":").slice(0, 128);
}
