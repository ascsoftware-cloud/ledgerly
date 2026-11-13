import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

const num = z.coerce.number();

const productRow = z
  .object({
    id: z.uuid(),
    name: z.string(),
    sku: z.string().nullable(),
    kind: z.enum(["product", "service"]),
    cost_cents: num,
    price_cents: num,
    vat_rate: num,
    track_stock: z.boolean(),
    reorder_level: num,
    stock_qty: num,
    supplier_id: z.uuid().nullable(),
    deleted_at: z.string().nullable(),
    suppliers: z.object({ name: z.string() }).nullable(),
  })
  .transform((r) => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    kind: r.kind,
    costCents: r.cost_cents,
    priceCents: r.price_cents,
    vatRate: r.vat_rate as 0 | 15,
    trackStock: r.track_stock,
    reorderLevel: r.reorder_level,
    stockQty: r.stock_qty,
    supplierId: r.supplier_id,
    supplierName: r.suppliers?.name ?? null,
    archived: r.deleted_at !== null,
  }));
export type ProductRow = z.output<typeof productRow>;

const PRODUCT_SELECT =
  "id, name, sku, kind, cost_cents, price_cents, vat_rate, track_stock, reorder_level, stock_qty, supplier_id, deleted_at, suppliers(name)";

export async function listProducts(ctx: WorkspaceContext, archived = false): Promise<ProductRow[]> {
  const supabase = await createServerClient();
  let q = supabase.from("products").select(PRODUCT_SELECT).eq("workspace_id", ctx.workspace.id);
  q = archived ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
  const { data } = await q.order("name").limit(1000);
  return z.array(productRow).catch([]).parse(data ?? []);
}

export async function getProduct(ctx: WorkspaceContext, id: string): Promise<ProductRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.from("products").select(PRODUCT_SELECT).eq("workspace_id", ctx.workspace.id).eq("id", id).maybeSingle();
  const parsed = productRow.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** What the invoice editor's product picker needs. */
export type PickerProduct = { id: string; name: string; sku: string | null; priceCents: number; vatRate: 0 | 15; trackStock: boolean; stockQty: number };
export async function pickerProducts(ctx: WorkspaceContext): Promise<PickerProduct[]> {
  const rows = await listProducts(ctx);
  return rows.map(({ id, name, sku, priceCents, vatRate, trackStock, stockQty }) => ({ id, name, sku, priceCents, vatRate, trackStock, stockQty }));
}

const movementRow = z.object({
  id: z.uuid(),
  qty_change: num,
  reason: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
});
export type MovementRow = z.infer<typeof movementRow>;

export async function listMovements(ctx: WorkspaceContext, productId: string, limit = 50): Promise<MovementRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("stock_movements")
    .select("id, qty_change, reason, note, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return z.array(movementRow).catch([]).parse(data ?? []);
}

const supplierRow = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  deleted_at: z.string().nullable(),
});
export type SupplierRow = z.infer<typeof supplierRow>;
const SUPPLIER_SELECT = "id, name, email, phone, notes, deleted_at";

export async function listSuppliers(ctx: WorkspaceContext, archived = false): Promise<SupplierRow[]> {
  const supabase = await createServerClient();
  let q = supabase.from("suppliers").select(SUPPLIER_SELECT).eq("workspace_id", ctx.workspace.id);
  q = archived ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
  const { data } = await q.order("name").limit(500);
  return z.array(supplierRow).catch([]).parse(data ?? []);
}

export async function getSupplier(ctx: WorkspaceContext, id: string): Promise<SupplierRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.from("suppliers").select(SUPPLIER_SELECT).eq("workspace_id", ctx.workspace.id).eq("id", id).maybeSingle();
  const parsed = supplierRow.safeParse(data);
  return parsed.success ? parsed.data : null;
}

const poLine = z.object({
  id: z.uuid(),
  product_id: z.uuid(),
  quantity: num,
  unit_cost_cents: num,
  products: z.object({ name: z.string(), sku: z.string().nullable(), track_stock: z.boolean() }).nullable(),
});
const poRow = z.object({
  id: z.uuid(),
  number: z.string(),
  status: z.enum(["draft", "sent", "received", "cancelled"]),
  expected_on: z.string().nullable(),
  notes: z.string().nullable(),
  sent_at: z.string().nullable(),
  received_at: z.string().nullable(),
  created_at: z.string(),
  suppliers: z.object({ id: z.uuid(), name: z.string(), email: z.string().nullable() }).nullable(),
  purchase_order_lines: z.array(poLine),
});
export type PurchaseOrder = z.infer<typeof poRow>;

const PO_SELECT =
  "id, number, status, expected_on, notes, sent_at, received_at, created_at, suppliers(id, name, email), purchase_order_lines(id, product_id, quantity, unit_cost_cents, products(name, sku, track_stock))";

export const poTotal = (o: Pick<PurchaseOrder, "purchase_order_lines">) =>
  o.purchase_order_lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_cost_cents), 0);

export async function listPurchaseOrders(ctx: WorkspaceContext): Promise<PurchaseOrder[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select(PO_SELECT)
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false })
    .limit(200);
  return z.array(poRow).catch([]).parse(data ?? []);
}

export async function getPurchaseOrder(ctx: WorkspaceContext, id: string): Promise<PurchaseOrder | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.from("purchase_orders").select(PO_SELECT).eq("workspace_id", ctx.workspace.id).eq("id", id).maybeSingle();
  const parsed = poRow.safeParse(data);
  return parsed.success ? parsed.data : null;
}
