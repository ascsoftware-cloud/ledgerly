import { formatDate } from "@/lib/dates";
import { whenLabel } from "@/features/bookings/booking";
import { formatMoney } from "@/lib/money";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type DocumentEmailInput = {
  kind: "invoice" | "quote" | "credit_note";
  number: string;
  businessName: string;
  clientName: string;
  totalCents: number;
  balanceCents: number;
  dueDate: string | null;
  link: string;
  message: string | null;
};

const WORD = { invoice: "Invoice", quote: "Quote", credit_note: "Credit note" } as const;
// Email clients mangle the narrow no-break space; use a plain one.
const money = (c: number) => formatMoney(c).replace(/ /g, " ");

/** Plain, readable email. Every value is escaped: business names and messages are user input. */
export function buildDocumentEmail(d: DocumentEmailInput): { subject: string; html: string; text: string } {
  const word = WORD[d.kind];
  const subject = `${word} ${d.number} from ${d.businessName}`;
  const first = d.clientName.trim().split(/\s+/)[0] ?? d.clientName;
  const amount = d.kind === "invoice" ? money(d.balanceCents) : money(d.totalCents);
  const when = d.dueDate ? formatDate(d.dueDate) : null;
  const line =
    d.kind === "invoice"
      ? `Amount due: ${amount}${when ? `, by ${when}` : ""}.`
      : d.kind === "quote"
        ? `Total: ${amount}${when ? `, valid until ${when}` : ""}.`
        : `Credit: ${amount}.`;
  const action = d.kind === "quote" ? "View and accept the quote" : d.kind === "invoice" ? "View and pay" : "View the credit note";

  const text = [
    `Hi ${first},`,
    "",
    d.message ?? `${d.businessName} has sent you ${word.toLowerCase()} ${d.number}.`,
    "",
    line,
    "",
    `${action}: ${d.link}`,
    "",
    `Reply to this email to reach ${d.businessName}.`,
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 16px">${s}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<div style="background:#ffffff;border:1px solid #e2e6ec;border-radius:16px;padding:28px">
${p(`Hi ${escapeHtml(first)},`)}
${p(escapeHtml(d.message ?? `${d.businessName} has sent you ${word.toLowerCase()} ${d.number}.`).replace(/\n/g, "<br>"))}
${p(`<strong>${escapeHtml(line)}</strong>`)}
<p style="margin:24px 0"><a href="${escapeHtml(d.link)}" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:bold">${escapeHtml(action)}</a></p>
<p style="margin:0;font-size:13px;color:#566176">Or open this link: ${escapeHtml(d.link)}</p>
</div>
<p style="margin:16px 0 0;font-size:12px;color:#566176;text-align:center">Reply to this email to reach ${escapeHtml(d.businessName)}. Sent with Ledgerly.</p>
</div></body></html>`;

  return { subject, html, text };
}

export type BookingEmailInput = {
  businessName: string;
  customerName: string;
  serviceName: string;
  startsAt: string;
  durationMin: number;
  icsLink: string;
};

/** Booking confirmation or 24-hour reminder. Times are SAST; every value is escaped. */
export function buildBookingEmail(b: BookingEmailInput, kind: "confirmed" | "reminder"): { subject: string; html: string; text: string } {
  const when = whenLabel(b.startsAt);
  const subject = `${kind === "reminder" ? "Reminder" : "Booked"}: ${b.serviceName} on ${when}`;
  // The name is typed by a stranger: greet by first name only when it looks like one (letters, hyphen, apostrophe).
  const token = b.customerName.trim().split(/\s+/)[0] ?? "";
  const first = /^[\p{L}][\p{L}'’-]{0,39}$/u.test(token) ? token : "there";
  const lead = kind === "reminder" ? `A reminder of your booking with ${b.businessName}.` : `Your booking with ${b.businessName} is confirmed.`;
  const detail = `${b.serviceName}, ${when} (${b.durationMin} minutes).`;
  const text = [`Hi ${first},`, "", lead, "", detail, "", `Add it to your calendar: ${b.icsLink}`, "", `Reply to this email to reach ${b.businessName}.`].join("\n");
  const p = (s: string) => `<p style="margin:0 0 16px">${s}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<div style="background:#ffffff;border:1px solid #e2e6ec;border-radius:16px;padding:28px">
${p(`Hi ${escapeHtml(first)},`)}
${p(escapeHtml(lead))}
${p(`<strong>${escapeHtml(detail)}</strong>`)}
<p style="margin:24px 0"><a href="${escapeHtml(b.icsLink)}" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:bold">Add to calendar</a></p>
<p style="margin:0;font-size:13px;color:#566176">Reply to this email to reach ${escapeHtml(b.businessName)}.</p>
</div>
</div>
</body></html>`;
  return { subject, html, text };
}
