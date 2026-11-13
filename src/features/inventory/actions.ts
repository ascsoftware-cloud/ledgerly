"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseDateZA } from "@/lib/dates";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace, type WorkspaceContext } from "@/lib/workspace";
import { adjustSchema, poLineSchema, productSchema, supplierSchema } from "./schema";

export type FormResult = { status: "idle" } | { status: "saved"; id: string; message: string } | { status: "error"; message: string };

const NO_WRITE = "Your role can view stock but not change it.";
const canWrite = (ctx: WorkspaceContext) => ctx.role !== "accountant";
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/stock`, "layout");
  revalidatePath(`/${slug}`);
};
/** The database says "LDG03" for a rule the person can fix; its message is written for them. */
const ruleMessage = (e: { code?: string; message?: string } | null, fallback: string) => (e?.code === "LDG03" && e.message ? e.message : fallback);

export async function saveProduct(slug: string, productId: string | null, _prev: FormResult, form: FormData): Promise<FormResult> {
  if (productId !== null && !z.uuid().safeParse(productId).success) return { status: "error", message: "That product doesn't exist." };
  const parsed = productSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { status: "error", message: NO_WRITE };
  const v = parsed.data;
  const fields = {
    name: v.name,
    sku: v.sku,
    kind: v.kind,
    cost_cents: v.costCents,
    price_cents: v.priceCents,
    vat_rate: v.vatRate,
    track_stock: v.trackStock,
    reorder_level: v.reorderLevel,
    supplier_id: v.supplierId,
  };
  const supabase = await createServerClient();
  let id = productId;
  if (id === null) {
    const { data, error } = await supabase.from("products").insert({ workspace_id: ctx.workspace.id, ...fields }).select("id").single();
    if (error || !data) {
      return { status: "error", message: error?.code === "23505" ? "Another product already uses that SKU." : error?.code === "23503" ? "Choose a supplier from the list." : "Couldn't save the product." };
    }
    id = data.id as string;
    if (v.openingStock !== null) {
      const { error: e2 } = await supabase.rpc("adjust_stock", { p_product: id, p_qty: v.openingStock, p_reason: "initial", p_note: "Opening stock" });
      if (e2) {
        refresh(slug);
        return { status: "saved", id, message: "Product saved, but the opening stock didn't. Add it with an adjustment." };
      }
    }
  } else {
    const { data, error } = await supabase.from("products").update(fields).eq("id", id).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
    if (error || !data) {
      return { status: "error", message: error?.code === "23505" ? "Another product already uses that SKU." : "Couldn't save the product." };
    }
  }
  refresh(slug);
  return { status: "saved", id, message: productId ? "Product updated." : "Product added." };
}

export async function setProductArchived(slug: string, productId: string, archived: boolean): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(productId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("products")
    .update({ deleted_at: archived ? new Date().toISOString() : null })
    .eq("id", productId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();
  refresh(slug);
  return { ok: !!data };
}

export async function adjustStock(slug: string, productId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  if (!z.uuid().safeParse(productId).success) return { status: "error", message: "That product doesn't exist." };
  const parsed = adjustSchema.safeParse({ change: form.get("change") ?? "", note: form.get("note") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { status: "error", message: NO_WRITE };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("adjust_stock", { p_product: productId, p_qty: parsed.data.change, p_reason: "adjustment", p_note: parsed.data.note });
  if (error) return { status: "error", message: ruleMessage(error, "Couldn't change the stock.") };
  refresh(slug);
  return { status: "saved", id: productId, message: `Stock is now ${data}.` };
}

export async function saveSupplier(slug: string, supplierId: string | null, _prev: FormResult, form: FormData): Promise<FormResult> {
  if (supplierId !== null && !z.uuid().safeParse(supplierId).success) return { status: "error", message: "That supplier doesn't exist." };
  const parsed = supplierSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { status: "error", message: NO_WRITE };
  const supabase = await createServerClient();
  const fields = parsed.data;
  let id = supplierId;
  if (id === null) {
    const { data, error } = await supabase.from("suppliers").insert({ workspace_id: ctx.workspace.id, ...fields }).select("id").single();
    if (error || !data) return { status: "error", message: "Couldn't save the supplier." };
    id = data.id as string;
  } else {
    const { data, error } = await supabase.from("suppliers").update(fields).eq("id", id).eq("workspace_id", ctx.workspace.id).select("id").maybeSingle();
    if (error || !data) return { status: "error", message: "Couldn't save the supplier." };
  }
  refresh(slug);
  return { status: "saved", id, message: supplierId ? "Supplier updated." : "Supplier added." };
}

export async function setSupplierArchived(slug: string, supplierId: string, archived: boolean): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(supplierId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false };
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("suppliers")
    .update({ deleted_at: archived ? new Date().toISOString() : null })
    .eq("id", supplierId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();
  refresh(slug);
  return { ok: !!data };
}

const orderSchema = z.object({
  supplierId: z.uuid({ message: "Choose a supplier." }),
  expectedOn: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return null;
      const iso = parseDateZA(v);
      if (!iso) {
        ctx.addIssue({ code: "custom", message: "Use a date like 31/01/2027." });
        return z.NEVER;
      }
      return iso;
    }),
  notes: z.string().trim().max(1000, "Keep the notes under 1000 characters.").optional(),
});

export async function createPurchaseOrder(slug: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const parsed = orderSchema.safeParse({ supplierId: form.get("supplierId") ?? "", expectedOn: form.get("expectedOn") ?? "", notes: form.get("notes") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { status: "error", message: NO_WRITE };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({ workspace_id: ctx.workspace.id, supplier_id: parsed.data.supplierId, expected_on: parsed.data.expectedOn, notes: parsed.data.notes || null })
    .select("id")
    .single();
  if (error || !data) return { status: "error", message: "Couldn't create the order." };
  refresh(slug);
  return { status: "saved", id: data.id as string, message: "Order started. Add the products you are buying." };
}

export async function addOrderLine(slug: string, orderId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  if (!z.uuid().safeParse(orderId).success) return { status: "error", message: "That order doesn't exist." };
  const parsed = poLineSchema.safeParse({ productId: form.get("productId") ?? "", quantity: form.get("quantity") ?? "", unitCost: form.get("unitCost") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { status: "error", message: NO_WRITE };
  const supabase = await createServerClient();
  const { error } = await supabase.from("purchase_order_lines").insert({
    workspace_id: ctx.workspace.id,
    po_id: orderId,
    product_id: parsed.data.productId,
    quantity: parsed.data.quantity,
    unit_cost_cents: parsed.data.unitCost,
  });
  if (error) return { status: "error", message: ruleMessage(error, "Couldn't add that product.") };
  refresh(slug);
  return { status: "saved", id: orderId, message: "Added." };
}

export async function removeOrderLine(slug: string, lineId: string): Promise<{ ok: boolean; message?: string }> {
  if (!z.uuid().safeParse(lineId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false, message: NO_WRITE };
  const supabase = await createServerClient();
  const { error } = await supabase.from("purchase_order_lines").delete().eq("id", lineId).eq("workspace_id", ctx.workspace.id);
  refresh(slug);
  return error ? { ok: false, message: ruleMessage(error, "Couldn't remove that line.") } : { ok: true };
}

export async function setOrderStatus(slug: string, orderId: string, status: "sent" | "cancelled"): Promise<{ ok: boolean; message?: string }> {
  if (!z.uuid().safeParse(orderId).success || (status !== "sent" && status !== "cancelled")) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false, message: NO_WRITE };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_purchase_order_status", { p_id: orderId, p_status: status });
  refresh(slug);
  return error ? { ok: false, message: ruleMessage(error, "Couldn't change the order.") } : { ok: true };
}

export async function receiveOrder(slug: string, orderId: string, updateCost: boolean): Promise<{ ok: boolean; message?: string }> {
  if (!z.uuid().safeParse(orderId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false, message: NO_WRITE };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("receive_purchase_order", { p_id: orderId, p_update_cost: updateCost === true });
  refresh(slug);
  return error ? { ok: false, message: ruleMessage(error, "Couldn't receive the order.") } : { ok: true };
}

export async function deleteOrder(slug: string, orderId: string): Promise<{ ok: boolean; message?: string }> {
  if (!z.uuid().safeParse(orderId).success) return { ok: false };
  const ctx = await requireWorkspace(slug);
  if (!canWrite(ctx)) return { ok: false, message: NO_WRITE };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("purchase_orders").delete().eq("id", orderId).eq("workspace_id", ctx.workspace.id).select("id");
  refresh(slug);
  return error || !data?.length ? { ok: false, message: "Only a draft order can be deleted." } : { ok: true };
}
