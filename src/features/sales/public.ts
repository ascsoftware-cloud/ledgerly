import { z } from "zod";
import type { DocumentViewData } from "./components/document-view";

const cents = z.number().int();

/** Exactly what public.get_public_document returns. Anything else is refused. */
export const publicDocumentSchema = z.object({
  kind: z.enum(["invoice", "quote", "credit_note"]),
  number: z.string(),
  status: z.enum(["sent", "viewed", "accepted", "declined", "part_paid", "paid", "void"]),
  issue_date: z.string(),
  due_date: z.string().nullable(),
  notes: z.string().nullable(),
  subtotal_cents: cents,
  vat_cents: cents,
  total_cents: cents,
  deposit_cents: cents,
  paid_cents: cents,
  credited_cents: cents,
  accepted_at: z.string().nullable(),
  source_number: z.string().nullable(),
  business: z.object({
    name: z.string(),
    vat_registered: z.boolean(),
    vat_number: z.string().nullable(),
    registration_number: z.string().nullable(),
    bank_details: z.record(z.string(), z.string()).nullable(),
  }),
  client: z.object({
    name: z.string(),
    address: z.string().nullable(),
    company: z.string().nullable(),
    company_vat: z.string().nullable(),
  }),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unit_cents: cents,
      discount_pct: z.number(),
      vat_rate: z.number(),
      net_cents: cents,
      gross_cents: cents,
    }),
  ),
});
export type PublicDocument = z.infer<typeof publicDocumentSchema>;

export function publicToViewData(p: PublicDocument): DocumentViewData {
  return {
    kind: p.kind,
    number: p.number,
    issueDate: p.issue_date,
    dueDate: p.due_date,
    notes: p.notes,
    subtotalCents: p.subtotal_cents,
    vatCents: p.vat_cents,
    totalCents: p.total_cents,
    depositCents: p.deposit_cents,
    paidCents: p.paid_cents,
    creditedCents: p.credited_cents,
    sourceNumber: p.source_number,
    business: {
      name: p.business.name,
      vatRegistered: p.business.vat_registered,
      vatNumber: p.business.vat_number,
      registrationNumber: p.business.registration_number,
      bankDetails: p.business.bank_details,
    },
    client: {
      name: p.client.name,
      email: null,
      phone: null,
      address: p.client.address,
      company: p.client.company,
      companyVat: p.client.company_vat,
    },
    lines: p.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitCents: l.unit_cents,
      discountPct: l.discount_pct,
      vatRate: l.vat_rate,
      netCents: l.net_cents,
      grossCents: l.gross_cents,
    })),
  };
}

/** Link tokens are 32 URL-safe characters; anything else is not worth a database call. */
export function isToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(t);
}
