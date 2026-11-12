import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";
import type { BankDetails } from "./schema";

const connectionRow = z.object({
  id: z.uuid(),
  provider: z.enum(["yoco", "payfast"]),
  mode: z.enum(["test", "live"]),
  merchant_id: z.string().nullable(),
  webhook_id: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
});

export async function getPaymentSettings(ctx: WorkspaceContext) {
  const supabase = await createServerClient();
  const [conns, settings] = await Promise.all([
    supabase
      .from("payment_connections")
      .select("id, provider, mode, merchant_id, webhook_id, status")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "active"),
    supabase.from("workspace_settings").select("bank_details, auto_reminders").eq("workspace_id", ctx.workspace.id).maybeSingle(),
  ]);
  const connections = z.array(connectionRow).catch([]).parse(conns.data ?? []);
  return {
    yoco: connections.find((c) => c.provider === "yoco") ?? null,
    payfast: connections.find((c) => c.provider === "payfast") ?? null,
    bank: (settings.data?.bank_details as Partial<BankDetails> | null) ?? null,
    autoReminders: settings.data?.auto_reminders === true,
  };
}

const paymentRow = z.object({
  id: z.uuid(),
  method: z.enum(["yoco", "payfast", "eft", "cash", "card", "other"]),
  amount_cents: z.coerce.number(),
  paid_on: z.string(),
  reference: z.string().nullable(),
  proof_path: z.string().nullable(),
});
export type PaymentRow = z.infer<typeof paymentRow>;

export async function listPayments(ctx: WorkspaceContext, documentId: string): Promise<PaymentRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("payments")
    .select("id, method, amount_cents, paid_on, reference, proof_path")
    .eq("workspace_id", ctx.workspace.id)
    .eq("document_id", documentId)
    .order("paid_on", { ascending: false });
  return z.array(paymentRow).catch([]).parse(data ?? []);
}
