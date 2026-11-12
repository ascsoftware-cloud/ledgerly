import { type BookingEmailInput, buildBookingEmail, buildDocumentEmail, type DocumentEmailInput } from "./email-template";
import type { Transport } from "./transport";

export type OutboxRow = {
  id: string;
  workspace_id: string;
  template: "document" | "reminder" | "booking_confirmed" | "booking_reminder";
  to_address: string;
  reply_to: string | null;
  payload: { document_id?: string; booking_id?: string; message?: string | null };
};

/**
 * One pass of the worker. Each message is finished independently, so one bad
 * message never blocks the rest. The outbox id doubles as the provider's idempotency key.
 */
export async function processOutbox(deps: {
  claim: () => Promise<OutboxRow[]>;
  /** Must only return a document from `workspaceId`: the worker bypasses row-level security. */
  load: (documentId: string, workspaceId: string, message: string | null) => Promise<DocumentEmailInput | null>;
  /** Same rule: only a booking from `workspaceId`. "cancelled" drops the message without sending. */
  loadBooking?: (bookingId: string, workspaceId: string) => Promise<BookingEmailInput | "cancelled" | null>;
  send: Transport;
  finish: (id: string, ok: boolean, providerId: string | null, error: string | null) => Promise<void>;
}): Promise<{ sent: number; failed: number }> {
  const rows = await deps.claim();
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.template === "booking_confirmed" || row.template === "booking_reminder") {
      const bookingId = row.payload.booking_id;
      const b = bookingId && deps.loadBooking ? await deps.loadBooking(bookingId, row.workspace_id) : null;
      if (b === "cancelled") {
        await deps.finish(row.id, true, null, "skipped: booking cancelled");
        continue;
      }
      if (!b) {
        await deps.finish(row.id, false, null, "Booking not found");
        failed++;
        continue;
      }
      const email = buildBookingEmail(b, row.template === "booking_reminder" ? "reminder" : "confirmed");
      const result = await deps.send({ to: row.to_address, replyTo: row.reply_to, ...email, idempotencyKey: row.id });
      await deps.finish(row.id, result.ok, result.ok ? result.id : null, result.ok ? null : result.error);
      if (result.ok) sent++;
      else failed++;
      continue;
    }
    const docId = row.payload.document_id;
    const input = docId ? await deps.load(docId, row.workspace_id, row.payload.message ?? null) : null;
    if (!input) {
      await deps.finish(row.id, false, null, "Document not found");
      failed++;
      continue;
    }
    const email = buildDocumentEmail(input);
    const result = await deps.send({ to: row.to_address, replyTo: row.reply_to, ...email, idempotencyKey: row.id });
    if (result.ok) {
      await deps.finish(row.id, true, result.id, null);
      sent++;
    } else {
      await deps.finish(row.id, false, null, result.error);
      failed++;
    }
  }
  return { sent, failed };
}
