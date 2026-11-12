import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  mappingGaps,
  NeedsAttention,
  NeedsReconnect,
  readMapping,
  type AccountingDocument,
  type AccountingMapping,
  type AccountingPayment,
} from "./accounting";
import { accessToken, loadConnection, markConnection, type Connection } from "./connections";
import { sageApiKey } from "./env";
import { describeFailure, isTransient, requestJson, type HttpResult } from "./http";
import type { JobOutcome } from "./job-types";
import * as sage from "./sage-za";
import * as xero from "./xero";

/**
 * Pushes Ledgerly invoices, credit notes and payments to Xero or Sage Accounting (SA).
 * One-way. sync_links remember what each record became, so a retried job updates nothing twice.
 */

class Transient extends Error {
  constructor(
    message: string,
    public retryIn?: number,
  ) {
    super(message);
  }
}

function fail(service: string, res: HttpResult): never {
  if (res.status === 401 || res.status === 403)
    throw new NeedsReconnect(`${service} refused the connection. Reconnect it.`);
  if (isTransient(res))
    throw new Transient(describeFailure(service, res), res.retryAfter ?? undefined);
  throw new NeedsAttention(describeFailure(service, res));
}

// ---------------------------------------------------------------------------
// Loading Ledgerly records (always scoped to the connection's workspace)
// ---------------------------------------------------------------------------
const docRow = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  kind: z.enum(["invoice", "quote", "credit_note"]),
  status: z.string(),
  number: z.string().nullable(),
  issue_date: z.string(),
  due_date: z.string().nullable(),
  total_cents: z.coerce.number(),
  source_id: z.uuid().nullable(),
  contacts: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    companies: z.object({ vat_number: z.string().nullable() }).nullable().optional(),
  }),
  sales_document_lines: z.array(
    z.object({
      position: z.number(),
      description: z.string(),
      quantity: z.coerce.number(),
      unit_cents: z.coerce.number(),
      discount_pct: z.coerce.number(),
      vat_rate: z.union([z.literal(0), z.literal(15)]),
      net_cents: z.coerce.number(),
      vat_cents: z.coerce.number(),
      gross_cents: z.coerce.number(),
    }),
  ),
});

async function loadDocument(workspaceId: string, id: string): Promise<AccountingDocument | null> {
  const { data } = await createAdminClient()
    .from("sales_documents")
    .select(
      "id, workspace_id, kind, status, number, issue_date, due_date, total_cents, source_id, contacts(id, name, email, phone, companies(vat_number)), sales_document_lines(position, description, quantity, unit_cents, discount_pct, vat_rate, net_cents, vat_cents, gross_cents)",
    )
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const p = docRow.safeParse(data);
  if (!p.success || p.data.kind === "quote" || !p.data.number) return null;
  const d = p.data;
  return {
    id: d.id,
    kind: d.kind as "invoice" | "credit_note",
    number: d.number!,
    issueDate: d.issue_date,
    dueDate: d.due_date,
    totalCents: d.total_cents,
    status: d.status,
    sourceId: d.source_id,
    contact: {
      id: d.contacts.id,
      name: d.contacts.name,
      email: d.contacts.email,
      phone: d.contacts.phone,
      vatNumber: d.contacts.companies?.vat_number ?? null,
    },
    lines: [...d.sales_document_lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitCents: l.unit_cents,
        discountPct: l.discount_pct,
        vatRate: l.vat_rate,
        netCents: l.net_cents,
        vatCents: l.vat_cents,
        grossCents: l.gross_cents,
      })),
  };
}

async function loadPayment(workspaceId: string, id: string): Promise<AccountingPayment | null> {
  const { data } = await createAdminClient()
    .from("payments")
    .select("id, document_id, method, amount_cents, paid_on, reference")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    documentId: data.document_id as string,
    method: data.method as string,
    amountCents: Number(data.amount_cents),
    paidOn: data.paid_on as string,
    reference: (data.reference as string | null) ?? null,
  };
}

type EntityType = "contact" | "document" | "payment";

async function link(conn: Connection, type: EntityType, localId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("sync_links")
    .select("external_id")
    .eq("connection_id", conn.id)
    .eq("entity_type", type)
    .eq("local_id", localId)
    .maybeSingle();
  return (data?.external_id as string | undefined) ?? null;
}

async function saveLink(
  conn: Connection,
  type: EntityType,
  localId: string,
  externalId: string,
  extra: { number?: string | null; externalTotal?: number | null; localTotal?: number | null } = {},
) {
  const { error } = await createAdminClient().rpc("save_sync_link", {
    p_connection: conn.id,
    p_entity_type: type,
    p_local: localId,
    p_external: externalId,
    p_number: extra.number ?? null,
    p_external_total: extra.externalTotal ?? null,
    p_local_total: extra.localTotal ?? null,
  });
  // The record exists on the other side but we could not remember it: retrying would duplicate it.
  if (error)
    throw new NeedsAttention(
      `Saved in the accounting app but the link could not be stored (${error.code}). Check for a duplicate before retrying.`,
    );
}

// ---------------------------------------------------------------------------
// Xero
// ---------------------------------------------------------------------------
/**
 * The Idempotency-Key covers the request body too: a retry of the same request is recognised,
 * but a corrected request (after fixing a mapping) is not mistaken for the failed one.
 */
function keyFor(parts: string[], body: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return xero.idempotencyKey([...parts, digest]);
}

async function xeroCall(
  conn: Connection,
  path: string,
  init: { method?: string; body?: unknown; idempotency?: string } = {},
) {
  const token = await accessToken(conn);
  return requestJson(`${xero.XERO_API}/${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "xero-tenant-id": conn.external_id ?? "",
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.idempotency ? { "Idempotency-Key": init.idempotency } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function xeroContact(conn: Connection, d: AccountingDocument): Promise<string> {
  const existing = await link(conn, "contact", d.contact.id);
  if (existing) return existing;
  const res = await xeroCall(conn, "Contacts", {
    method: "POST",
    body: xero.contactPayload(d.contact),
    idempotency: keyFor(["ldg", conn.id, "contact", d.contact.id], xero.contactPayload(d.contact)),
  });
  let id = res.ok ? xero.createdContactId(res.body) : null;
  if (!id && xero.isDuplicateContactName(res.body)) {
    // A contact with this name already exists in Xero: use it rather than fail.
    const found = await xeroCall(
      conn,
      `Contacts?searchTerm=${encodeURIComponent(d.contact.name)}&summaryOnly=true`,
    );
    id = found.ok ? xero.findContactByName(found.body, d.contact.name) : null;
  }
  if (!id) fail("Xero (contact)", res);
  await saveLink(conn, "contact", d.contact.id, id);
  return id;
}

async function xeroPushDocument(
  conn: Connection,
  d: AccountingDocument,
  m: AccountingMapping,
): Promise<void> {
  if (await link(conn, "document", d.id)) return;
  const gaps = mappingGaps(m, { zeroRated: d.lines.some((l) => l.vatRate === 0) });
  if (gaps.length) throw new NeedsAttention(`Choose ${gaps.join(", ")} on the Xero settings page.`);
  const contactId = await xeroContact(conn, d);
  const path = d.kind === "credit_note" ? "CreditNotes?unitdp=4" : "Invoices?unitdp=4";
  const payload = xero.documentPayload(d, contactId, m);
  const res = await xeroCall(conn, path, {
    method: "POST",
    body: payload,
    idempotency: keyFor(["ldg", conn.id, "doc", d.id], payload),
  });
  const created = res.ok ? xero.createdDocument(res.body, d.kind) : null;
  if (!created) fail("Xero", res);
  await saveLink(conn, "document", d.id, created.id, {
    number: created.number,
    externalTotal: created.totalCents,
    localTotal: d.totalCents,
  });

  // A credit note reduces the invoice it came from, as it does in Ledgerly.
  if (d.kind === "credit_note" && d.sourceId) {
    const invoiceId = await link(conn, "document", d.sourceId);
    if (invoiceId) {
      const allocation = xero.allocationPayload(invoiceId, d.totalCents, d.issueDate);
      const alloc = await xeroCall(conn, `CreditNotes/${created.id}/Allocations`, {
        method: "PUT",
        body: allocation,
        idempotency: keyFor(["ldg", conn.id, "alloc", d.id], allocation),
      });
      if (!alloc.ok)
        throw new NeedsAttention(
          `Credit note sent to Xero, but allocating it to the invoice failed: ${describeFailure("Xero", alloc)}`,
        );
    }
  }
}

async function xeroVoid(conn: Connection, d: AccountingDocument): Promise<void> {
  const externalId = await link(conn, "document", d.id);
  if (!externalId) return; // never reached Xero: nothing to void
  const path = d.kind === "credit_note" ? `CreditNotes/${externalId}` : `Invoices/${externalId}`;
  const payload = xero.voidPayload(d.kind, externalId);
  const res = await xeroCall(conn, path, {
    method: "POST",
    body: payload,
    idempotency: keyFor(["ldg", conn.id, "void", d.id], payload),
  });
  if (!res.ok) fail("Xero (void)", res);
}

async function xeroPushPayment(
  conn: Connection,
  p: AccountingPayment,
  m: AccountingMapping,
  doc: AccountingDocument,
): Promise<void> {
  if (await link(conn, "payment", p.id)) return;
  if (!m.bankAccount)
    throw new NeedsAttention("Choose a bank account for payments on the Xero settings page.");
  await xeroPushDocument(conn, doc, m);
  const invoiceId = await link(conn, "document", doc.id);
  if (!invoiceId) throw new Transient("The invoice is not in Xero yet");
  const payload = xero.paymentPayload(p, invoiceId, m);
  const res = await xeroCall(conn, "Payments", {
    method: "PUT",
    body: payload,
    idempotency: keyFor(["ldg", conn.id, "pay", p.id], payload),
  });
  const id = res.ok ? xero.createdPaymentId(res.body) : null;
  if (!id) fail("Xero (payment)", res);
  await saveLink(conn, "payment", p.id, id);
}

// ---------------------------------------------------------------------------
// Sage Accounting (South Africa)
// ---------------------------------------------------------------------------
async function sageCall(
  conn: Connection,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
) {
  const key = sageApiKey();
  const username = typeof conn.settings._username === "string" ? conn.settings._username : "";
  if (!key) throw new NeedsAttention("Sage is not set up on this server (SAGE_API_KEY).");
  if (!username || !conn.secret) throw new NeedsReconnect("Sage login missing. Reconnect Sage.");
  const res = await requestJson(sage.sageUrl(path, key, conn.external_id, init.query), {
    method: init.method ?? "GET",
    headers: {
      Authorization: sage.basicAuth(username, conn.secret),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status === 429)
    throw new Transient("Sage's daily request limit was reached", sage.RATE_LIMIT_RETRY_SECONDS);
  return res;
}

async function sageCustomer(conn: Connection, d: AccountingDocument): Promise<number> {
  const existing = await link(conn, "contact", d.contact.id);
  if (existing) return Number(existing);
  const res = await sageCall(conn, "Customer/Save", {
    method: "POST",
    body: sage.customerPayload(d.contact),
  });
  const saved = res.ok ? sage.savedId(res.body) : null;
  if (!saved) fail("Sage (customer)", res);
  await saveLink(conn, "contact", d.contact.id, saved.id);
  return Number(saved.id);
}

async function sagePushDocument(
  conn: Connection,
  d: AccountingDocument,
  m: AccountingMapping,
): Promise<void> {
  if (await link(conn, "document", d.id)) return;
  const gaps = mappingGaps(m, { zeroRated: d.lines.some((l) => l.vatRate === 0) });
  if (gaps.length) throw new NeedsAttention(`Choose ${gaps.join(", ")} on the Sage settings page.`);
  const customerId = await sageCustomer(conn, d);
  const service = d.kind === "credit_note" ? "CustomerReturn/Save" : "TaxInvoice/Save";
  const res = await sageCall(conn, service, {
    method: "POST",
    body: sage.documentPayload(d, customerId, m),
    query: { useSystemDocumentNumber: "true" },
  });
  const saved = res.ok ? sage.savedId(res.body) : null;
  if (!saved) fail("Sage", res);
  await saveLink(conn, "document", d.id, saved.id, {
    number: saved.number,
    externalTotal: saved.totalCents,
    localTotal: d.totalCents,
  });
}

async function sagePushPayment(
  conn: Connection,
  p: AccountingPayment,
  m: AccountingMapping,
  doc: AccountingDocument,
): Promise<void> {
  if (await link(conn, "payment", p.id)) return;
  if (!m.bankAccount)
    throw new NeedsAttention("Choose a bank account for payments on the Sage settings page.");
  await sagePushDocument(conn, doc, m);
  const customerId = await sageCustomer(conn, doc);
  const res = await sageCall(conn, "CustomerReceipt/Save", {
    method: "POST",
    body: sage.receiptPayload(p, customerId, m, doc.number),
    query: { useSystemDocumentNumber: "true" },
  });
  const saved = res.ok ? sage.savedId(res.body) : null;
  if (!saved) fail("Sage (receipt)", res);
  await saveLink(conn, "payment", p.id, saved.id);
}

// ---------------------------------------------------------------------------
// Queue entry points
// ---------------------------------------------------------------------------
async function run(
  connectionId: string,
  work: (conn: Connection, m: AccountingMapping) => Promise<void>,
): Promise<JobOutcome> {
  const conn = await loadConnection(connectionId);
  if (
    !conn ||
    conn.status !== "active" ||
    (conn.provider !== "xero" && conn.provider !== "sage_za")
  )
    return { ok: true };
  try {
    await work(conn, readMapping(conn.settings));
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    if (e instanceof NeedsReconnect) {
      await markConnection(conn.id, "needs_reauth", msg);
      return { ok: false, error: msg, stop: true };
    }
    if (e instanceof NeedsAttention) return { ok: false, error: msg, stop: true };
    if (e instanceof Transient)
      return { ok: false, error: msg, retryIn: e.retryIn, transient: true };
    return { ok: false, error: msg };
  }
}

export function pushDocument(connectionId: string, documentId: string): Promise<JobOutcome> {
  return run(connectionId, async (conn, m) => {
    const d = await loadDocument(conn.workspace_id, documentId);
    if (!d) return;
    if (d.status === "void") return; // voided before it was pushed: nothing to send
    if (conn.provider === "xero") await xeroPushDocument(conn, d, m);
    else await sagePushDocument(conn, d, m);
  });
}

export function voidDocument(connectionId: string, documentId: string): Promise<JobOutcome> {
  return run(connectionId, async (conn) => {
    const d = await loadDocument(conn.workspace_id, documentId);
    if (!d) return;
    if (conn.provider === "xero") return xeroVoid(conn, d);
    if (await link(conn, "document", d.id)) {
      // Sage SA's API has no void for tax invoices or returns.
      throw new NeedsAttention(
        `${d.number} was voided in Ledgerly. Void it in Sage by hand: Sage's API cannot.`,
      );
    }
  });
}

export function pushPayment(connectionId: string, paymentId: string): Promise<JobOutcome> {
  return run(connectionId, async (conn, m) => {
    const p = await loadPayment(conn.workspace_id, paymentId);
    if (!p) return;
    const doc = await loadDocument(conn.workspace_id, p.documentId);
    if (!doc) return;
    if (conn.provider === "xero") await xeroPushPayment(conn, p, m, doc);
    else await sagePushPayment(conn, p, m, doc);
  });
}

// ---------------------------------------------------------------------------
// Mapping screen
// ---------------------------------------------------------------------------
export type MappingOptions = {
  sales: { value: string; label: string }[];
  banks: { value: string; label: string }[];
  taxes: { value: string; label: string; rate?: number }[];
};

/** The accounts and VAT rates to choose from. Null if the app cannot be reached right now. */
export async function mappingOptions(
  workspaceId: string,
  connectionId: string,
): Promise<MappingOptions | null> {
  const conn = await loadConnection(connectionId);
  if (!conn || conn.workspace_id !== workspaceId || conn.status !== "active") return null;
  try {
    if (conn.provider === "xero") {
      const [accounts, taxes] = await Promise.all([
        xeroCall(conn, "Accounts"),
        xeroCall(conn, "TaxRates"),
      ]);
      if (!accounts.ok || !taxes.ok) return null;
      return {
        sales: xero.salesAccounts(accounts.body),
        banks: xero.bankAccounts(accounts.body),
        taxes: xero.salesTaxRates(taxes.body),
      };
    }
    if (conn.provider === "sage_za") {
      const [accounts, banks, taxes] = await Promise.all([
        sageCall(conn, "Account/Get"),
        sageCall(conn, "BankAccount/Get"),
        sageCall(conn, "TaxType/Get"),
      ]);
      if (!accounts.ok || !banks.ok || !taxes.ok) return null;
      return {
        sales: sage.accounts(accounts.body),
        banks: sage.bankAccounts(banks.body),
        taxes: sage.taxTypes(taxes.body),
      };
    }
  } catch (e) {
    if (e instanceof NeedsReconnect)
      await markConnection(conn.id, "needs_reauth", (e as Error).message);
    return null;
  }
  return null;
}

/** Sage connect step: checks the login and lists the companies it can see. */
export async function sageCompanies(
  username: string,
  password: string,
): Promise<
  { ok: true; companies: { value: string; label: string }[] } | { ok: false; message: string }
> {
  const key = sageApiKey();
  if (!key)
    return {
      ok: false,
      message: "Sage isn't set up on this server yet. Ask ASC to add the Sage API key.",
    };
  const res = await requestJson(sage.sageUrl("Company/Get", key, null), {
    headers: { Authorization: sage.basicAuth(username, password), Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403)
    return { ok: false, message: "Sage didn't accept that email and password." };
  if (res.status === 429)
    return {
      ok: false,
      message: "Sage has blocked this login for 24 hours after too many attempts.",
    };
  if (!res.ok) return { ok: false, message: "Couldn't reach Sage. Try again in a moment." };
  const companies = sage.companies(res.body);
  if (!companies.length) return { ok: false, message: "That Sage login has no companies." };
  return { ok: true, companies };
}
