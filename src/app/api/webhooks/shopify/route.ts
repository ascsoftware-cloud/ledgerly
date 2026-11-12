import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueJob } from "@/server/integrations/connections";
import { shopifyApp } from "@/server/integrations/env";
import { gid, isShopDomain, verifyWebhook } from "@/server/integrations/shopify";
import { forgetShop } from "@/server/integrations/shopify-service";

/**
 * Every Shopify webhook for every connected store lands here (the HMAC secret belongs to ASC's
 * Shopify app, not to a store). Order: verify the HMAC on the raw body, find the store's
 * connection, record the delivery once, then queue a small refresh. Payloads are hints only:
 * the worker re-reads the product, stock or order from Shopify's API.
 * Shopify waits 5 seconds at most, so nothing slow happens here.
 */
export async function POST(req: Request) {
  const app = shopifyApp();
  if (!app) return new Response("Shopify is not configured", { status: 503 });
  const body = await req.text();
  if (!verifyWebhook(body, req.headers.get("x-shopify-hmac-sha256"), app.clientSecret)) {
    return new Response("Invalid webhook", { status: 401 });
  }

  const topic = (req.headers.get("x-shopify-topic") ?? "").toLowerCase();
  const shop = (req.headers.get("x-shopify-shop-domain") ?? "").toLowerCase();
  const deliveryId =
    req.headers.get("x-shopify-webhook-id") ?? req.headers.get("x-shopify-event-id") ?? "";
  if (!isShopDomain(shop) || !deliveryId) return new Response("Missing headers", { status: 400 });

  const db = createAdminClient();
  const { data: conns } = await db
    .from("integration_connections")
    .select("id, workspace_id, status")
    .eq("provider", "shopify")
    .eq("external_id", shop);
  const live = (conns ?? []).find((c) => c.status === "active");

  // Mandatory privacy webhooks. Ledgerly keeps no Shopify customer data, so there is nothing to
  // send or erase for a customer; erasing a shop removes everything cached for it.
  if (topic === "customers/data_request" || topic === "customers/redact")
    return Response.json({ ok: true });
  if (topic === "shop/redact") {
    for (const c of conns ?? [])
      await forgetShop(c.id as string, "Shopify asked us to erase this store's data.");
    return Response.json({ ok: true });
  }
  if (!live) return Response.json({ ignored: "no live connection" });

  const fresh = await db.rpc("record_integration_event", {
    p_provider: "shopify",
    p_event_id: deliveryId,
    p_workspace: live.workspace_id,
    p_topic: topic,
    p_outcome: "received",
  });
  if (fresh.data === false) return Response.json({ duplicate: true });

  let payload: unknown = null;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ ignored: "unreadable payload" });
  }

  const connectionId = live.id as string;
  const queue = async (kind: string, id: string | null) => {
    if (!id) return;
    await enqueueJob({
      connectionId,
      kind: "shopify_refresh",
      payload: { kind, id },
      dedupe: `shopify:${connectionId}:refresh:${kind}:${id}`,
      delaySeconds: 5,
    });
  };

  switch (topic) {
    case "products/create":
    case "products/update":
      await queue("product", gid("Product", payload, "id"));
      break;
    case "products/delete":
      await queue("product_deleted", gid("Product", payload, "id"));
      break;
    case "inventory_levels/update":
      await queue("inventory", gid("InventoryItem", payload, "inventory_item_id"));
      break;
    case "orders/create":
    case "orders/updated":
      await queue("order", gid("Order", payload, "id"));
      break;
    case "app/uninstalled":
      await forgetShop(connectionId, "The Ledgerly app was removed from the Shopify store.");
      break;
  }
  return Response.json({ ok: true });
}
