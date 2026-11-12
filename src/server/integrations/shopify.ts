import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { randsToCents } from "./http";

/**
 * Shopify: OAuth (authorization code grant, expiring offline tokens), webhook verification,
 * GraphQL Admin queries and the mapping from Shopify's shapes to our cache rows.
 * Verified against shopify.dev on 2026-11-12; see docs/plans/integrations.md.
 */

/** Pinned. Shopify supports each version for 12 months: bump this every quarter or two. */
export const SHOPIFY_API_VERSION = "2026-10";
export const SHOPIFY_SCOPES = [
  "read_products",
  "read_inventory",
  "read_locations",
  "read_orders",
] as const;
/** Webhook topics the dashboard listens to. Payloads are only hints: we re-read from the API. */
export const SHOPIFY_TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "INVENTORY_LEVELS_UPDATE",
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "APP_UNINSTALLED",
] as const;

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** "my-store", "my-store.myshopify.com" or a pasted admin URL → "my-store.myshopify.com". */
export function normaliseShop(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").split(/[/?#]/)[0]!;
  if (s === "admin.shopify.com") {
    const m = /admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/.exec(input.trim().toLowerCase());
    s = m ? m[1]! : "";
  }
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return SHOP.test(s) && s.length <= 120 ? s : null;
}

export function isShopDomain(s: string | null | undefined): s is string {
  return typeof s === "string" && SHOP.test(s);
}

export function authorizeUrl(input: {
  shop: string;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL(`https://${input.shop}/admin/oauth/authorize`);
  u.searchParams.set("client_id", input.clientId);
  u.searchParams.set("scope", SHOPIFY_SCOPES.join(","));
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("state", input.state);
  return u.toString();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The OAuth callback's `hmac`: remove it, sort the remaining parameters, join as
 * name=value with "&", HMAC-SHA256 with the app's client secret, hex.
 */
export function verifyOAuthCallback(params: URLSearchParams, clientSecret: string): boolean {
  const given = params.get("hmac");
  if (!given || !/^[0-9a-f]{64}$/i.test(given)) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const expected = createHmac("sha256", clientSecret).update(message).digest();
  return safeEqual(Buffer.from(given.toLowerCase(), "hex"), expected);
}

/** Webhooks: X-Shopify-Hmac-SHA256 is base64 HMAC-SHA256 of the raw body, keyed with the client secret. */
export function verifyWebhook(
  rawBody: string,
  header: string | null,
  clientSecret: string,
): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", clientSecret).update(rawBody, "utf8").digest();
  return safeEqual(Buffer.from(header, "base64"), expected);
}

export const tokenResponse = z.object({
  access_token: z.string().min(10),
  scope: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(10).optional(),
  refresh_token_expires_in: z.number().int().optional(),
});
export type ShopifyTokens = z.infer<typeof tokenResponse>;

/** Body for exchanging the callback code. `expiring=1` asks for an expiring offline token. */
export function codeExchangeBody(input: {
  clientId: string;
  clientSecret: string;
  code: string;
}): URLSearchParams {
  return new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    expiring: "1",
  });
}

export function refreshBody(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): URLSearchParams {
  return new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
}

/** Granted scopes must cover what the dashboard reads; a merchant can decline optional ones. */
export function missingScopes(granted: string | undefined): string[] {
  const have = new Set((granted ?? "").split(",").map((s) => s.trim()));
  return SHOPIFY_SCOPES.filter(
    (s) => !have.has(s) && !(s.startsWith("read_") && have.has(s.replace("read_", "write_"))),
  );
}

// ---------------------------------------------------------------------------
// GraphQL. Page sizes keep each query's cost well under Shopify's single-query limit.
// ---------------------------------------------------------------------------
const PRODUCT_FIELDS = `
  id title status vendor productType totalInventory updatedAt
  featuredMedia { preview { image { url } } }
  variants(first: 30) { nodes { id title sku price inventoryQuantity inventoryItem { id tracked } } }`;

export const Q_SHOP = `query { shop { name currencyCode myshopifyDomain } }`;
export const Q_PRODUCTS = `query Products($cursor: String) {
  products(first: 25, after: $cursor, sortKey: ID) { pageInfo { hasNextPage endCursor } nodes { ${PRODUCT_FIELDS} } }
}`;
export const Q_PRODUCT = `query Product($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`;

const LEVEL_FIELDS = `id inventoryLevels(first: 10) { nodes { location { id name } quantities(names: ["available"]) { name quantity } } }`;
export const Q_INVENTORY = `query Inventory($cursor: String) {
  inventoryItems(first: 50, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ${LEVEL_FIELDS} } }
}`;
export const Q_INVENTORY_ITEM = `query InventoryItem($id: ID!) { inventoryItem(id: $id) { ${LEVEL_FIELDS} } }`;

const ORDER_FIELDS = `id name createdAt updatedAt cancelledAt displayFinancialStatus displayFulfillmentStatus
  currentTotalPriceSet { shopMoney { amount currencyCode } } currentSubtotalLineItemsQuantity`;
export const Q_ORDERS = `query Orders($cursor: String, $query: String) {
  orders(first: 100, after: $cursor, sortKey: UPDATED_AT, query: $query) { pageInfo { hasNextPage endCursor } nodes { ${ORDER_FIELDS} } }
}`;
export const Q_ORDER = `query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;

export const M_WEBHOOK = `mutation Subscribe($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) { webhookSubscription { id } userErrors { field message } }
}`;

/** Orders only reach back 60 days without read_all_orders, which the dashboard does not ask for. */
export function ordersSearch(since: Date): string {
  return `updated_at:>='${since.toISOString().replace(/\.\d{3}Z$/, "Z")}'`;
}

// ---------------------------------------------------------------------------
// Responses → cache rows
// ---------------------------------------------------------------------------
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });

const variantNode = z.object({
  id: z.string(),
  title: z.string().nullable(),
  sku: z.string().nullable(),
  price: z.union([z.string(), z.number()]).nullable(),
  inventoryQuantity: z.number().int().nullable(),
  inventoryItem: z.object({ id: z.string(), tracked: z.boolean().nullable() }).nullable(),
});
const productNode = z.object({
  id: z.string().startsWith("gid://shopify/Product/"),
  title: z.string(),
  status: z.string().nullable(),
  vendor: z.string().nullable(),
  productType: z.string().nullable(),
  totalInventory: z.number().int().nullable(),
  updatedAt: z.string().nullable(),
  featuredMedia: z
    .object({ preview: z.object({ image: z.object({ url: z.string() }).nullable() }).nullable() })
    .nullable()
    .optional(),
  variants: z.object({ nodes: z.array(variantNode) }),
});

export type ProductRow = {
  id: string;
  title: string;
  status: string | null;
  vendor: string | null;
  product_type: string | null;
  total_inventory: number | null;
  image_url: string | null;
  shop_updated_at: string | null;
};
export type VariantRow = {
  id: string;
  product_id: string;
  title: string | null;
  sku: string | null;
  price: number | null;
  inventory_quantity: number | null;
  inventory_item_id: string | null;
  tracked: boolean | null;
};

function cut(s: string | null | undefined, n: number): string | null {
  return s == null ? null : s.slice(0, n);
}

export function productRows(node: unknown): { product: ProductRow; variants: VariantRow[] } | null {
  const p = productNode.safeParse(node);
  if (!p.success) return null;
  const image = p.data.featuredMedia?.preview?.image?.url ?? null;
  return {
    product: {
      id: p.data.id,
      title: p.data.title.slice(0, 300),
      status: cut(p.data.status, 20),
      vendor: cut(p.data.vendor, 200),
      product_type: cut(p.data.productType, 200),
      total_inventory: p.data.totalInventory,
      image_url: image && image.startsWith("https://") ? image.slice(0, 1000) : null,
      shop_updated_at: p.data.updatedAt,
    },
    variants: p.data.variants.nodes
      .filter((v) => v.id.startsWith("gid://shopify/ProductVariant/"))
      .map((v) => {
        const cents = v.price == null ? null : randsToCents(v.price);
        return {
          id: v.id,
          product_id: p.data.id,
          title: cut(v.title, 300),
          sku: cut(v.sku, 200),
          price: cents == null ? null : cents / 100,
          inventory_quantity: v.inventoryQuantity,
          inventory_item_id: cut(v.inventoryItem?.id, 100),
          tracked: v.inventoryItem?.tracked ?? null,
        };
      }),
  };
}

const levelItem = z.object({
  id: z.string().startsWith("gid://shopify/InventoryItem/"),
  inventoryLevels: z.object({
    nodes: z.array(
      z.object({
        location: z.object({
          id: z.string().startsWith("gid://shopify/Location/"),
          name: z.string().nullable(),
        }),
        quantities: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
      }),
    ),
  }),
});
export type LevelRow = {
  inventory_item_id: string;
  location_id: string;
  location_name: string | null;
  available: number;
};

export function levelRows(node: unknown): LevelRow[] | null {
  const p = levelItem.safeParse(node);
  if (!p.success) return null;
  return p.data.inventoryLevels.nodes.map((l) => ({
    inventory_item_id: p.data.id,
    location_id: l.location.id,
    location_name: cut(l.location.name, 200),
    available: l.quantities.find((q) => q.name === "available")?.quantity ?? 0,
  }));
}

const orderNode = z.object({
  id: z.string().startsWith("gid://shopify/Order/"),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  displayFinancialStatus: z.string().nullable(),
  displayFulfillmentStatus: z.string().nullable(),
  currentTotalPriceSet: z.object({
    shopMoney: z.object({ amount: z.union([z.string(), z.number()]), currencyCode: z.string() }),
  }),
  currentSubtotalLineItemsQuantity: z.number().int().nullable(),
});
export type OrderRow = {
  id: string;
  name: string;
  shop_created_at: string;
  shop_updated_at: string | null;
  cancelled_at: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  total: number;
  currency: string;
  item_count: number | null;
};

/** Order headers only: no customer, address or contact fields are requested or kept. */
export function orderRow(node: unknown): OrderRow | null {
  const p = orderNode.safeParse(node);
  if (!p.success) return null;
  const cents = randsToCents(p.data.currentTotalPriceSet.shopMoney.amount);
  const currency = p.data.currentTotalPriceSet.shopMoney.currencyCode;
  if (cents === null || !/^[A-Z]{3}$/.test(currency)) return null;
  return {
    id: p.data.id,
    name: p.data.name.slice(0, 60),
    shop_created_at: p.data.createdAt,
    shop_updated_at: p.data.updatedAt,
    cancelled_at: p.data.cancelledAt,
    financial_status: cut(p.data.displayFinancialStatus, 40),
    fulfillment_status: cut(p.data.displayFulfillmentStatus, 40),
    total: cents / 100,
    currency,
    item_count: p.data.currentSubtotalLineItemsQuantity,
  };
}

export function connectionPage(
  data: unknown,
  key: string,
): { nodes: unknown[]; hasNextPage: boolean; endCursor: string | null } | null {
  const conn = (data as Record<string, unknown> | null)?.[key];
  const parsed = z.object({ nodes: z.array(z.unknown()), pageInfo }).safeParse(conn);
  return parsed.success ? { nodes: parsed.data.nodes, ...parsed.data.pageInfo } : null;
}

/** Webhook payloads carry REST ids; this turns one into the GraphQL id we cache by. */
export function gid(
  kind: "Product" | "Order" | "InventoryItem",
  payload: unknown,
  field: string,
): string | null {
  const o = (payload ?? {}) as Record<string, unknown>;
  const graph = o.admin_graphql_api_id;
  if (field === "id" && typeof graph === "string" && graph.startsWith(`gid://shopify/${kind}/`))
    return graph;
  const raw = o[field];
  if (
    (typeof raw === "number" && Number.isSafeInteger(raw)) ||
    (typeof raw === "string" && /^\d{1,20}$/.test(raw))
  ) {
    return `gid://shopify/${kind}/${raw}`;
  }
  return null;
}

/** GraphQL errors worth retrying later (cost throttling). */
export function isThrottled(body: unknown): boolean {
  const errors = (body as { errors?: { extensions?: { code?: string } }[] } | null)?.errors;
  return Array.isArray(errors) && errors.some((e) => e.extensions?.code === "THROTTLED");
}
