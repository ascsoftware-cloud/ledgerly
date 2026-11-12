import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import type { Kind } from "./schema";
import type { StoredStatus } from "./status";

const status = z.enum(["draft", "sent", "viewed", "accepted", "declined", "part_paid", "paid", "void"]);
const cents = z.coerce.number();

const listRow = z.object({
  id: z.uuid(),
  kind: z.enum(["invoice", "quote", "credit_note"]),
  number: z.string().nullable(),
  status,
  issue_date: z.string(),
  due_date: z.string().nullable(),
  total_cents: cents,
  paid_cents: cents,
  credited_cents: cents,
  contacts: z.object({ name: z.string() }).nullable(),
});
export type DocumentListRow = z.infer<typeof listRow>;

export async function listDocuments(ctx: WorkspaceContext, kind: Kind): Promise<DocumentListRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("sales_documents")
    .select("id, kind, number, status, issue_date, due_date, total_cents, paid_cents, credited_cents, contacts(name)")
    .eq("workspace_id", ctx.workspace.id)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(200);
  return z.array(listRow).catch([]).parse(data ?? []);
}

const lineRow = z.object({
  id: z.uuid(),
  position: z.number(),
  description: z.string(),
  quantity: z.coerce.number(),
  unit_cents: cents,
  discount_pct: z.coerce.number(),
  vat_rate: z.number(),
  net_cents: cents,
  vat_cents: cents,
  gross_cents: cents,
});

const docRow = z.object({
  id: z.uuid(),
  kind: z.enum(["invoice", "quote", "credit_note"]),
  number: z.string().nullable(),
  status,
  issue_date: z.string(),
  due_date: z.string().nullable(),
  notes: z.string().nullable(),
  deposit_type: z.enum(["pct", "amount"]).nullable(),
  deposit_value: z.coerce.number().nullable(),
  subtotal_cents: cents,
  vat_cents: cents,
  total_cents: cents,
  deposit_cents: cents,
  paid_cents: cents,
  credited_cents: cents,
  source_id: z.uuid().nullable(),
  public_token: z.string(),
  sent_at: z.string().nullable(),
  viewed_at: z.string().nullable(),
  accepted_at: z.string().nullable(),
  contact_id: z.uuid(),
  contacts: z.object({
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    companies: z.object({ name: z.string(), vat_number: z.string().nullable() }).nullable(),
  }),
});

export type Business = {
  name: string;
  vatRegistered: boolean;
  vatNumber: string | null;
  registrationNumber: string | null;
  bankDetails: Record<string, string> | null;
};

export type FullDocument = z.infer<typeof docRow> & {
  lines: z.infer<typeof lineRow>[];
  business: Business;
  sourceNumber: string | null;
};

const settingsRow = z
  .object({
    business_name: z.string().nullable(),
    vat_registered: z.boolean(),
    vat_number: z.string().nullable(),
    registration_number: z.string().nullable(),
    bank_details: z.record(z.string(), z.string()).nullable(),
  })
  .nullable();

export async function getBusiness(ctx: WorkspaceContext): Promise<Business> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("workspace_settings")
    .select("business_name, vat_registered, vat_number, registration_number, bank_details")
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  const s = settingsRow.catch(null).parse(data ?? null);
  return {
    name: s?.business_name || ctx.workspace.name,
    vatRegistered: s?.vat_registered ?? false,
    vatNumber: s?.vat_number ?? null,
    registrationNumber: s?.registration_number ?? null,
    bankDetails: s?.bank_details ?? null,
  };
}

export async function getDocument(ctx: WorkspaceContext, id: string): Promise<FullDocument | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const ws = ctx.workspace.id;
  const [doc, lines, business] = await Promise.all([
    supabase
      .from("sales_documents")
      .select(
        "id, kind, number, status, issue_date, due_date, notes, deposit_type, deposit_value, subtotal_cents, vat_cents, total_cents, deposit_cents, paid_cents, credited_cents, source_id, public_token, sent_at, viewed_at, accepted_at, contact_id, contacts(name, email, phone, address, companies(name, vat_number))",
      )
      .eq("workspace_id", ws)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("sales_document_lines")
      .select("id, position, description, quantity, unit_cents, discount_pct, vat_rate, net_cents, vat_cents, gross_cents")
      .eq("workspace_id", ws)
      .eq("document_id", id)
      .order("position"),
    getBusiness(ctx),
  ]);
  const d = docRow.safeParse(doc.data);
  if (!d.success) return null;

  let sourceNumber: string | null = null;
  if (d.data.source_id) {
    const { data: src } = await supabase
      .from("sales_documents")
      .select("number")
      .eq("workspace_id", ws)
      .eq("id", d.data.source_id)
      .maybeSingle();
    sourceNumber = (src?.number as string | null) ?? null;
  }
  return { ...d.data, lines: z.array(lineRow).catch([]).parse(lines.data ?? []), business, sourceNumber };
}

export type { StoredStatus };
