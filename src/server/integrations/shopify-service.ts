import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import {
  accessToken,
  enqueueJob,
  loadConnection,
  markConnection,
  type Connection,
} from "./connections";
import { describeFailure, isTransient, requestJson } from "./http";
import { NeedsReconnect } from "./accounting";
import type { JobOutcome } from "./job-types";
import * as sh from "./shopify";

/**
 * Shopify reads for the Shop dashboard. Everything is read-only on Shopify's side.
 * A full sync runs as a resumable batch job (products → inventory → orders); webhooks queue
 * small refreshes of one product, inventory item or order, re-read from the API.
 */

type GqlResult = { ok: true; data: Record<string, unknown> } | { ok: false; outcome: JobOutcome };

export async function graphql(
  conn: Connection,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GqlResult> {
  if (!sh.isShopDomain(conn.external_id))
    return { ok: false, outcome: { ok: false, error: "No store on this connection", stop: true } };
  let token: string;
  try {
    token = await accessToken(conn);
  } catch (e) {
    return {
      ok: false,
      outcome: { ok: false, error: (e as Error).message, stop: e instanceof NeedsReconnect },
    };
  }
  const res = await requestJson<{ data?: Record<string, unknown>; errors?: unknown }>(
    `https://${conn.external_id}/admin/api/${sh.SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
      timeoutMs: 30_000,
    },
  );
  if (res.status === 401 || res.status === 403) {
    await markConnection(
      conn.id,
      "needs_reauth",
      "Shopify refused the access token. Reconnect the store.",
    );
    return {
      ok: false,
      outcome: {
        ok: false,
        error: "Shopify refused the access token. Reconnect the store.",
        stop: true,
      },
    };
  }
  if (sh.isThrottled(res.body))
    return {
      ok: false,
      outcome: { ok: false, error: "Shopify asked us to slow down", retryIn: 10, transient: true },
    };
  if (!res.ok || !res.body?.data) {
    const detail =
      res.body && typeof res.body === "object" && "errors" in res.body
        ? JSON.stringify(res.body.errors).slice(0, 300)
        : "";
    return {
      ok: false,
      outcome: {
        ok: false,
        error: detail ? `Shopify query failed: ${detail}` : describeFailure("Shopify", res),
        retryIn: res.retryAfter ?? undefined,
        transient: isTransient(res),
      },
    };
  }
  return { ok: true, data: res.body.data };
}

/**
 * Saves a store after the OAuth callback verified Shopify's HMAC and our state cookie. The
 * database re-checks that `userId` is an owner or admin of the workspace.
 */
export async function saveShopifyConnection(input: {
  workspaceId: string;
  userId: string;
  shop: string;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
}): Promise<{ ok: true; id: string } | { ok: false; code: string | null }> {
  const { data, error } = await createAdminClient().rpc("connect_shopify", {
    p_workspace: input.workspaceId,
    p_actor: input.userId,
    p_shop: input.shop,
    p_name: input.shop,
    p_settings: { low_stock: 5 },
    p_access: input.accessToken,
    p_refresh: input.refreshToken,
    p_expires_in: input.expiresIn,
  });
  if (error || typeof data !== "string") return { ok: false, code: error?.code ?? null };
  return { ok: true, id: data };
}

/** After install: shop name and currency, then webhooks, then the first sync. */
export async function afterConnect(connectionId: string): Promise<string | null> {
  const conn = await loadConnection(connectionId);
  if (!conn) return "Connection not found";
  const db = createAdminClient();
  const shop = await graphql(conn, sh.Q_SHOP);
  if (shop.ok) {
    const s = shop.data.shop as { name?: string; currencyCode?: string } | undefined;
    await db
      .from("integration_connections")
      .update({
        external_name: (s?.name ?? conn.external_name ?? conn.external_id ?? "").slice(0, 200),
        settings: {
          ...conn.settings,
          _currency: /^[A-Z]{3}$/.test(s?.currencyCode ?? "") ? s!.currencyCode : "ZAR",
        },
      })
      .eq("id", conn.id);
  }
  const failures: string[] = [];
  for (const topic of sh.SHOPIFY_TOPICS) {
    const r = await graphql(conn, sh.M_WEBHOOK, {
      topic,
      webhookSubscription: { uri: `${siteUrl()}/api/webhooks/shopify` },
    });
    const errs = r.ok
      ? ((r.data.webhookSubscriptionCreate as { userErrors?: { message: string }[] } | undefined)
          ?.userErrors ?? [])
      : [{ message: r.outcome.ok ? "" : r.outcome.error }];
    // "Address for this topic has already been taken" means it exists already: that is fine.
    const real = errs.filter((e) => e.message && !/already been taken/i.test(e.message));
    if (real.length) failures.push(`${topic}: ${real[0]!.message}`);
  }
  await db
    .from("shopify_sync_state")
    .upsert(
      {
        connection_id: conn.id,
        workspace_id: conn.workspace_id,
        phase: "products",
        cursor: null,
        run_started_at: null,
        finished_at: null,
      },
      { onConflict: "connection_id" },
    );
  await enqueueJob({
    connectionId: conn.id,
    kind: "shopify_sync",
    payload: { full: true },
    dedupe: `shopify:${conn.id}:sync`,
  });
  return failures.length
    ? `Some live updates could not be switched on (${failures.join("; ")}). The dashboard still refreshes every 6 hours.`
    : null;
}

const PAGES_PER_RUN = 8;
const ORDERS_FIRST_SYNC_DAYS = 60;

type SyncState = {
  phase: "products" | "inventory" | "orders" | "done";
  cursor: string | null;
  run_started_at: string | null;
  orders_since: string | null;
};

async function saveProducts(conn: Connection, nodes: unknown[], at: string) {
  const db = createAdminClient();
  const products = [];
  const variants = [];
  for (const n of nodes) {
    const rows = sh.productRows(n);
    if (!rows) continue;
    products.push({
      ...rows.product,
      workspace_id: conn.workspace_id,
      connection_id: conn.id,
      synced_at: at,
    });
    variants.push(
      ...rows.variants.map((v) => ({
        ...v,
        workspace_id: conn.workspace_id,
        connection_id: conn.id,
        synced_at: at,
      })),
    );
  }
  if (products.length) {
    const { error } = await db
      .from("shopify_products")
      .upsert(products, { onConflict: "connection_id,id" });
    if (error) throw new Error(`saving products failed: ${error.code}`);
  }
  if (variants.length) {
    const { error } = await db
      .from("shopify_variants")
      .upsert(variants, { onConflict: "connection_id,id" });
    if (error) throw new Error(`saving variants failed: ${error.code}`);
  }
  if (products.length) {
    // Variants removed in Shopify are the ones this read did not touch.
    await db
      .from("shopify_variants")
      .delete()
      .eq("connection_id", conn.id)
      .in(
        "product_id",
        products.map((p) => p.id),
      )
      .lt("synced_at", at);
  }
}

async function saveLevels(conn: Connection, nodes: unknown[]) {
  const rows = nodes
    .flatMap((n) => sh.levelRows(n) ?? [])
    .map((l) => ({
      ...l,
      workspace_id: conn.workspace_id,
      connection_id: conn.id,
      synced_at: new Date().toISOString(),
    }));
  if (!rows.length) return;
  const { error } = await createAdminClient()
    .from("shopify_inventory_levels")
    .upsert(rows, { onConflict: "connection_id,inventory_item_id,location_id" });
  if (error) throw new Error(`saving stock levels failed: ${error.code}`);
}

async function saveOrders(conn: Connection, nodes: unknown[]) {
  const rows = nodes
    .map((n) => sh.orderRow(n))
    .filter((r): r is sh.OrderRow => r !== null)
    .map((r) => ({
      ...r,
      workspace_id: conn.workspace_id,
      connection_id: conn.id,
      synced_at: new Date().toISOString(),
    }));
  if (!rows.length) return;
  const { error } = await createAdminClient()
    .from("shopify_orders")
    .upsert(rows, { onConflict: "connection_id,id" });
  if (error) throw new Error(`saving orders failed: ${error.code}`);
}

/**
 * One slice of a sync. A full sync reads every product and stock level and the last 60 days of
 * orders, then removes products it no longer saw. A routine sync (every 6 hours) re-reads
 * products and stock, and orders changed since the last run.
 */
export async function runSync(connectionId: string, full: boolean): Promise<JobOutcome> {
  const conn = await loadConnection(connectionId);
  if (!conn || conn.status !== "active" || conn.provider !== "shopify") return { ok: true };
  const db = createAdminClient();
  const { data: stateRow } = await db
    .from("shopify_sync_state")
    .select("phase, cursor, run_started_at, orders_since")
    .eq("connection_id", conn.id)
    .maybeSingle();
  let state: SyncState = (stateRow as SyncState | null) ?? {
    phase: "products",
    cursor: null,
    run_started_at: null,
    orders_since: null,
  };
  if (state.phase === "done")
    state = { ...state, phase: "products", cursor: null, run_started_at: null };
  const runStarted = state.run_started_at ?? new Date().toISOString();

  const save = async (patch: Partial<SyncState> & { finished_at?: string | null }) => {
    await db
      .from("shopify_sync_state")
      .upsert(
        {
          connection_id: conn.id,
          workspace_id: conn.workspace_id,
          ...state,
          run_started_at: runStarted,
          ...patch,
        },
        { onConflict: "connection_id" },
      );
  };

  try {
    for (let page = 0; page < PAGES_PER_RUN; page++) {
      if (state.phase === "products") {
        const r = await graphql(conn, sh.Q_PRODUCTS, { cursor: state.cursor });
        if (!r.ok) return r.outcome;
        const p = sh.connectionPage(r.data, "products");
        if (!p)
          return { ok: false, error: "Shopify's products answer was not in the expected shape" };
        await saveProducts(conn, p.nodes, new Date().toISOString());
        state = p.hasNextPage
          ? { ...state, cursor: p.endCursor }
          : { ...state, phase: "inventory", cursor: null };
        if (!p.hasNextPage)
          await db.rpc("shopify_prune_products", { p_connection: conn.id, p_before: runStarted });
      } else if (state.phase === "inventory") {
        const r = await graphql(conn, sh.Q_INVENTORY, { cursor: state.cursor });
        if (!r.ok) return r.outcome;
        const p = sh.connectionPage(r.data, "inventoryItems");
        if (!p) return { ok: false, error: "Shopify's stock answer was not in the expected shape" };
        await saveLevels(conn, p.nodes);
        state = p.hasNextPage
          ? { ...state, cursor: p.endCursor }
          : { ...state, phase: "orders", cursor: null };
      } else if (state.phase === "orders") {
        const since =
          !full && state.orders_since
            ? new Date(Date.parse(state.orders_since) - 10 * 60_000)
            : new Date(Date.now() - ORDERS_FIRST_SYNC_DAYS * 86_400_000);
        const r = await graphql(conn, sh.Q_ORDERS, {
          cursor: state.cursor,
          query: sh.ordersSearch(since),
        });
        if (!r.ok) return r.outcome;
        const p = sh.connectionPage(r.data, "orders");
        if (!p)
          return { ok: false, error: "Shopify's orders answer was not in the expected shape" };
        await saveOrders(conn, p.nodes);
        if (p.hasNextPage) {
          state = { ...state, cursor: p.endCursor };
        } else {
          state = { ...state, phase: "done", cursor: null, orders_since: runStarted };
          await save({ finished_at: new Date().toISOString(), run_started_at: null });
          await markConnection(conn.id, null, null, true);
          return { ok: true };
        }
      }
      await save({});
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message, transient: true };
  }
  // More pages left: continue in a fresh request so no single call runs long.
  return { ok: true, continueIn: 2 };
}

/** A webhook said something changed: re-read just that thing. */
export async function refresh(
  connectionId: string,
  payload: { kind?: string; id?: string },
): Promise<JobOutcome> {
  const conn = await loadConnection(connectionId);
  if (!conn || conn.status !== "active") return { ok: true };
  const db = createAdminClient();
  const id = payload.id ?? "";
  if (payload.kind === "product" && id.startsWith("gid://shopify/Product/")) {
    const r = await graphql(conn, sh.Q_PRODUCT, { id });
    if (!r.ok) return r.outcome;
    if (r.data.product === null) {
      await db.from("shopify_products").delete().eq("connection_id", conn.id).eq("id", id);
      return { ok: true };
    }
    await saveProducts(conn, [r.data.product], new Date().toISOString());
    return { ok: true };
  }
  if (payload.kind === "product_deleted" && id.startsWith("gid://shopify/Product/")) {
    await db.from("shopify_products").delete().eq("connection_id", conn.id).eq("id", id);
    return { ok: true };
  }
  if (payload.kind === "inventory" && id.startsWith("gid://shopify/InventoryItem/")) {
    const r = await graphql(conn, sh.Q_INVENTORY_ITEM, { id });
    if (!r.ok) return r.outcome;
    if (r.data.inventoryItem) await saveLevels(conn, [r.data.inventoryItem]);
    return { ok: true };
  }
  if (payload.kind === "order" && id.startsWith("gid://shopify/Order/")) {
    const r = await graphql(conn, sh.Q_ORDER, { id });
    if (!r.ok) return r.outcome;
    if (r.data.order) await saveOrders(conn, [r.data.order]);
    return { ok: true };
  }
  return { ok: true };
}

/** Uninstalled from Shopify, or Shopify asked us to erase the shop: drop the cache and the credentials. */
export async function forgetShop(connectionId: string, reason: string) {
  const db = createAdminClient();
  await db.rpc("shopify_forget", { p_connection: connectionId });
  // The token no longer works and must not linger in Vault.
  await db.rpc("disable_integration", { p_connection: connectionId, p_reason: reason });
}
