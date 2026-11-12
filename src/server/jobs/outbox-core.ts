import { buildDocumentEmail, type DocumentEmailInput } from "./email-template";
import type { Transport } from "./transport";

export type OutboxRow = {
  id: string;
  workspace_id: string;
  template: "document" | "reminder";
  to_address: string;
  reply_to: string | null;
  payload: { document_id?: string; message?: string | null };
};

/**
 * One pass of the worker. Each message is finished independently, so one bad
 * message never blocks the rest. The outbox id doubles as the provider's idempotency key.
 */
export async function processOutbox(deps: {
  claim: () => Promise<OutboxRow[]>;
  /** Must only return a document from `workspaceId`: the worker bypasses row-level security. */
  load: (documentId: string, workspaceId: string, message: string | null) => Promise<DocumentEmailInput | null>;
  send: Transport;
  finish: (id: string, ok: boolean, providerId: string | null, error: string | null) => Promise<void>;
}): Promise<{ sent: number; failed: number }> {
  const rows = await deps.claim();
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
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
