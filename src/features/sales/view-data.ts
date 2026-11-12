import type { DocumentViewData } from "./components/document-view";
import type { FullDocument } from "./queries";

/** Database row → what DocumentView shows. */
export function toViewData(d: FullDocument): DocumentViewData {
  return {
    kind: d.kind,
    number: d.number,
    issueDate: d.issue_date,
    dueDate: d.due_date,
    notes: d.notes,
    subtotalCents: d.subtotal_cents,
    vatCents: d.vat_cents,
    totalCents: d.total_cents,
    depositCents: d.deposit_cents,
    paidCents: d.paid_cents,
    creditedCents: d.credited_cents,
    sourceNumber: d.sourceNumber,
    business: d.business,
    client: {
      name: d.contacts.name,
      email: d.contacts.email,
      phone: d.contacts.phone,
      address: d.contacts.address,
      company: d.contacts.companies?.name ?? null,
      companyVat: d.contacts.companies?.vat_number ?? null,
    },
    lines: d.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitCents: l.unit_cents,
      discountPct: l.discount_pct,
      vatRate: l.vat_rate,
      grossCents: l.gross_cents,
      netCents: l.net_cents,
    })),
  };
}
