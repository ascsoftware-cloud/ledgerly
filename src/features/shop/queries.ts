import "server-only";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import type { WorkspaceContext } from "@/lib/workspace";

/** Reads the cached copy of the workspace's Shopify store. Row-level security limits it to members. */

const num = z.coerce.number();

const product = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string().nullable(),
  vendor: z.string().nullable(),
  total_inventory: z.number().nullable(),
  image_url: z.string().nullable(),
  shopify_variants: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      sku: z.string().nullable(),
      price: num.nullable(),
      inventory_quantity: z.number().nullable(),
      inventory_item_id: z.string().nullable(),
      tracked: z.boolean().nullable(),
    }),
  ),
});
export type ShopProduct = z.infer<typeof product>;

const order = z.object({
  id: z.string(),
  name: z.string(),
  shop_created_at: z.string(),
  cancelled_at: z.string().nullable(),
  financial_status: z.string().nullable(),
  fulfillment_status: z.string().nullable(),
  total: num,
  currency: z.string(),
  item_count: z.number().nullable(),
});
export type ShopOrder = z.infer<typeof order>;

export async function getShop(ctx: WorkspaceContext) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("integration_connections")
    .select("id, status, external_id, external_name, settings, last_sync_at, last_error")
    .eq("workspace_id", ctx.workspace.id)
    .eq("provider", "shopify")
    .neq("status", "disabled")
    .maybeSingle();
  if (!data) return null;
  const settings = (data.settings ?? {}) as Record<string, unknown>;
  const { data: state } = await supabase
    .from("shopify_sync_state")
    .select("phase, finished_at")
    .eq("connection_id", data.id)
    .maybeSingle();
  return {
    id: data.id as string,
    status: data.status as string,
    domain: data.external_id as string,
    name: (data.external_name as string | null) ?? (data.external_id as string),
    currency: typeof settings._currency === "string" ? settings._currency : "ZAR",
    lowStock: typeof settings.low_stock === "number" ? settings.low_stock : 5,
    lastSync: (data.last_sync_at as string | null) ?? null,
    lastError: (data.last_error as string | null) ?? null,
    syncing: !!state && state.phase !== "done",
  };
}

export async function listProducts(
  ctx: WorkspaceContext,
  connectionId: string,
  q: string,
): Promise<ShopProduct[]> {
  const supabase = await createServerClient();
  let query = supabase
    .from("shopify_products")
    .select(
      "id, title, status, vendor, total_inventory, image_url, shopify_variants(id, title, sku, price, inventory_quantity, inventory_item_id, tracked)",
    )
    .eq("workspace_id", ctx.workspace.id)
    .eq("connection_id", connectionId)
    .order("title")
    .limit(200);
  const term = q
    .trim()
    .slice(0, 60)
    .replace(/[%_,()]/g, " ");
  if (term) query = query.ilike("title", `%${term}%`);
  const { data } = await query;
  return z
    .array(product)
    .catch([])
    .parse(data ?? []);
}

export async function listOrders(
  ctx: WorkspaceContext,
  connectionId: string,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<ShopOrder[]> {
  const supabase = await createServerClient();
  let query = supabase
    .from("shopify_orders")
    .select(
      "id, name, shop_created_at, cancelled_at, financial_status, fulfillment_status, total, currency, item_count",
    )
    .eq("workspace_id", ctx.workspace.id)
    .eq("connection_id", connectionId)
    .order("shop_created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.sinceDays)
    query = query.gte(
      "shop_created_at",
      new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString(),
    );
  const { data } = await query;
  return z
    .array(order)
    .catch([])
    .parse(data ?? []);
}

export type LowStockRow = {
  product: string;
  variant: string | null;
  sku: string | null;
  quantity: number;
};

export async function lowStock(
  ctx: WorkspaceContext,
  connectionId: string,
  threshold: number,
): Promise<LowStockRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("shopify_variants")
    .select("title, sku, inventory_quantity, shopify_products!inner(title, status)")
    .eq("workspace_id", ctx.workspace.id)
    .eq("connection_id", connectionId)
    .eq("tracked", true)
    .lte("inventory_quantity", threshold)
    .order("inventory_quantity")
    .limit(100);
  return z
    .array(
      z.object({
        title: z.string().nullable(),
        sku: z.string().nullable(),
        inventory_quantity: z.number(),
        shopify_products: z.object({ title: z.string(), status: z.string().nullable() }),
      }),
    )
    .catch([])
    .parse(data ?? [])
    .filter((v) => (v.shopify_products.status ?? "ACTIVE") === "ACTIVE")
    .map((v) => ({
      product: v.shopify_products.title,
      variant: v.title && v.title !== "Default Title" ? v.title : null,
      sku: v.sku,
      quantity: v.inventory_quantity,
    }));
}

export type StockRow = {
  location: string;
  product: string;
  variant: string | null;
  sku: string | null;
  available: number;
};

/** Stock per location, joined to variants in memory (Shopify ties them by inventory item). */
export async function stockByLocation(
  ctx: WorkspaceContext,
  connectionId: string,
): Promise<StockRow[]> {
  const supabase = await createServerClient();
  const [levels, variants] = await Promise.all([
    supabase
      .from("shopify_inventory_levels")
      .select("inventory_item_id, location_name, available")
      .eq("workspace_id", ctx.workspace.id)
      .eq("connection_id", connectionId)
      .limit(2000),
    supabase
      .from("shopify_variants")
      .select("title, sku, inventory_item_id, shopify_products!inner(title)")
      .eq("workspace_id", ctx.workspace.id)
      .eq("connection_id", connectionId)
      .not("inventory_item_id", "is", null)
      .limit(2000),
  ]);
  const byItem = new Map(
    z
      .array(
        z.object({
          title: z.string().nullable(),
          sku: z.string().nullable(),
          inventory_item_id: z.string(),
          shopify_products: z.object({ title: z.string() }),
        }),
      )
      .catch([])
      .parse(variants.data ?? [])
      .map((v) => [v.inventory_item_id, v]),
  );
  return z
    .array(
      z.object({
        inventory_item_id: z.string(),
        location_name: z.string().nullable(),
        available: z.number(),
      }),
    )
    .catch([])
    .parse(levels.data ?? [])
    .flatMap((l) => {
      const v = byItem.get(l.inventory_item_id);
      if (!v) return [];
      return [
        {
          location: l.location_name ?? "Location",
          product: v.shopify_products.title,
          variant: v.title && v.title !== "Default Title" ? v.title : null,
          sku: v.sku,
          available: l.available,
        },
      ];
    })
    .sort((a, b) => a.location.localeCompare(b.location) || a.product.localeCompare(b.product));
}
