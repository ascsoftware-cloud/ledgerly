/**
 * What an accounting app needs from Ledgerly, in one shape for Xero and Sage. Money stays in
 * cents until the last moment; each provider converts to its own decimal format.
 */

export type AccountingContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
};

export type AccountingLine = {
  description: string;
  quantity: number;
  unitCents: number;
  discountPct: number;
  vatRate: 0 | 15;
  netCents: number;
  vatCents: number;
  grossCents: number;
};

export type AccountingDocument = {
  id: string;
  kind: "invoice" | "credit_note";
  number: string;
  issueDate: string;
  dueDate: string | null;
  totalCents: number;
  status: string;
  contact: AccountingContact;
  lines: AccountingLine[];
  /** For a credit note: the invoice it reduces. */
  sourceId: string | null;
};

export type AccountingPayment = {
  id: string;
  documentId: string;
  method: string;
  amountCents: number;
  paidOn: string;
  reference: string | null;
};

/** Settings chosen on the mapping screen, stored on the connection. */
export type AccountingMapping = {
  salesAccount: string | null;
  bankAccount: string | null;
  taxStandard: string | null;
  taxZero: string | null;
};

export function readMapping(
  settings: Record<string, unknown> | null | undefined,
): AccountingMapping {
  const s = settings ?? {};
  const str = (k: string) =>
    typeof s[k] === "string" && (s[k] as string).trim() ? (s[k] as string).trim() : null;
  return {
    salesAccount: str("sales_account"),
    bankAccount: str("bank_account"),
    taxStandard: str("tax_standard"),
    taxZero: str("tax_zero"),
  };
}

export function mappingGaps(
  m: AccountingMapping,
  needs: { payments?: boolean; zeroRated?: boolean } = {},
): string[] {
  const gaps: string[] = [];
  if (!m.salesAccount) gaps.push("a sales account");
  if (!m.taxStandard) gaps.push("a VAT rate for 15% lines");
  if (needs.zeroRated && !m.taxZero) gaps.push("a VAT rate for 0% lines");
  if (needs.payments && !m.bankAccount) gaps.push("a bank account for payments");
  return gaps;
}

/** A failure the person must fix (mapping, missing data): retrying on its own will not help. */
export class NeedsAttention extends Error {}
/** The other side refused our credentials: the person has to reconnect. */
export class NeedsReconnect extends Error {}
