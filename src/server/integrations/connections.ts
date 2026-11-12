import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { shopifyApp, xeroApp } from "./env";
import { describeFailure, requestJson } from "./http";
import { NeedsReconnect } from "./accounting";
import * as shopify from "./shopify";
import * as xero from "./xero";

/**
 * Server-only access to a connection's credentials, and OAuth token refresh.
 * Uses the service role because credentials live in Vault. Every caller passes a connection id
 * it already tied to a workspace the signed-in person may act for (or a queued job's own id).
 */

export type Provider = "courier_guy" | "shopify" | "xero" | "sage_za";

const row = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  provider: z.enum(["courier_guy", "shopify", "xero", "sage_za"]),
  status: z.enum(["active", "needs_reauth", "disabled"]),
  mode: z.enum(["test", "live"]),
  external_id: z.string().nullable(),
  external_name: z.string().nullable(),
  settings: z.record(z.string(), z.unknown()).catch({}),
  secret: z.string().nullable(),
  refresh: z.string().nullable(),
  token_expires_at: z.string().nullable(),
});
export type Connection = z.infer<typeof row>;

export async function loadConnection(id: string): Promise<Connection | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const { data } = await createAdminClient().rpc("integration_secrets", { p_connection: id });
  const parsed = row.safeParse(Array.isArray(data) ? data[0] : null);
  return parsed.success ? parsed.data : null;
}

/** The live connection a workspace has to one provider, with credentials. */
export async function activeConnection(
  workspaceId: string,
  provider: Provider,
): Promise<Connection | null> {
  const { data } = await createAdminClient()
    .from("integration_connections")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();
  const conn = data?.id ? await loadConnection(data.id as string) : null;
  return conn && conn.workspace_id === workspaceId && conn.status === "active" ? conn : null;
}

export async function markConnection(
  id: string,
  status: "active" | "needs_reauth" | null,
  error: string | null,
  synced = false,
) {
  await createAdminClient().rpc("mark_integration", {
    p_connection: id,
    p_status: status,
    p_error: error,
    p_synced: synced,
  });
}

async function storeTokens(
  id: string,
  access: string,
  refresh: string | null,
  expiresIn: number | null,
) {
  const { error } = await createAdminClient().rpc("store_integration_tokens", {
    p_connection: id,
    p_secret: access,
    p_refresh: refresh,
    p_expires_in: expiresIn,
  });
  if (error) throw new Error(`store_integration_tokens failed: ${error.code}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A usable access token for Xero or Shopify. Refreshes when it has under two minutes left.
 * Only one worker refreshes at a time (a 60-second lease in the database); the others wait for
 * the new token instead of spending the refresh token a second time.
 */
export async function accessToken(conn: Connection): Promise<string> {
  const fresh = (c: Connection) =>
    c.secret && c.token_expires_at && Date.parse(c.token_expires_at) - Date.now() > 120_000
      ? c.secret
      : null;
  const now = fresh(conn);
  if (now) return now;
  if (conn.provider === "shopify" && !conn.refresh && conn.secret && !conn.token_expires_at)
    return conn.secret; // non-expiring token
  if (!conn.refresh) throw new NeedsReconnect("No refresh token: reconnect the app.");

  const db = createAdminClient();
  const { data: leased } = await db.rpc("claim_token_refresh", { p_connection: conn.id });
  if (leased !== true) {
    for (let i = 0; i < 8; i++) {
      await sleep(1500);
      const again = await loadConnection(conn.id);
      const token = again ? fresh(again) : null;
      if (token) return token;
    }
    throw new Error("Another worker is refreshing this connection's token");
  }

  if (conn.provider === "xero") {
    const app = xeroApp();
    if (!app)
      throw new NeedsReconnect(
        "Xero is not set up on this server (XERO_CLIENT_ID / XERO_CLIENT_SECRET).",
      );
    const res = await requestJson(xero.XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: xero.basicAuth(app.clientId, app.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh }),
    });
    const tokens = xero.tokenResponse.safeParse(res.body);
    if (!res.ok || !tokens.success) {
      const reconnect = res.status === 400 || res.status === 401;
      await markConnection(
        conn.id,
        reconnect ? "needs_reauth" : null,
        describeFailure("Xero sign-in", res),
      );
      if (reconnect) throw new NeedsReconnect("Xero signed this connection out. Reconnect Xero.");
      throw new Error(describeFailure("Xero sign-in", res));
    }
    await storeTokens(
      conn.id,
      tokens.data.access_token,
      tokens.data.refresh_token,
      tokens.data.expires_in,
    );
    return tokens.data.access_token;
  }

  if (conn.provider === "shopify") {
    const app = shopifyApp();
    if (!app || !shopify.isShopDomain(conn.external_id))
      throw new NeedsReconnect("Shopify is not set up on this server.");
    const res = await requestJson(`https://${conn.external_id}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: shopify.refreshBody({
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        refreshToken: conn.refresh,
      }),
    });
    const tokens = shopify.tokenResponse.safeParse(res.body);
    if (!res.ok || !tokens.success) {
      const reconnect = res.status === 400 || res.status === 401 || res.status === 403;
      await markConnection(
        conn.id,
        reconnect ? "needs_reauth" : null,
        describeFailure("Shopify sign-in", res),
      );
      if (reconnect)
        throw new NeedsReconnect("Shopify signed this connection out. Reconnect the store.");
      throw new Error(describeFailure("Shopify sign-in", res));
    }
    await storeTokens(
      conn.id,
      tokens.data.access_token,
      tokens.data.refresh_token ?? null,
      tokens.data.expires_in ?? null,
    );
    return tokens.data.access_token;
  }

  throw new Error(`${conn.provider} does not use OAuth tokens`);
}

export async function enqueueJob(input: {
  connectionId: string;
  kind:
    | "push_document"
    | "void_document"
    | "push_payment"
    | "shopify_sync"
    | "shopify_refresh"
    | "track_shipment";
  entityId?: string | null;
  payload?: Record<string, unknown>;
  dedupe: string;
  delaySeconds?: number;
}): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("enqueue_integration_job", {
    p_connection: input.connectionId,
    p_kind: input.kind,
    p_entity: input.entityId ?? null,
    p_payload: input.payload ?? {},
    p_dedupe: input.dedupe,
    p_delay_seconds: input.delaySeconds ?? 0,
  });
  if (error) throw new Error(`enqueue_integration_job failed: ${error.code}`);
  return (data as string | null) ?? null;
}

/**
 * Before a Xero connection is deleted: tell Xero too, so the organisation stops counting against
 * ASC's connection allowance and the refresh token stops working. Best effort: a failure here
 * never blocks disconnecting in Ledgerly.
 */
export async function releaseAtProvider(workspaceId: string, connectionId: string): Promise<void> {
  const conn = await loadConnection(connectionId);
  if (!conn || conn.workspace_id !== workspaceId || conn.provider !== "xero") return;
  const app = xeroApp();
  if (!app) return;
  try {
    const xeroConnectionId =
      typeof conn.settings._xero_connection_id === "string"
        ? conn.settings._xero_connection_id
        : null;
    if (xeroConnectionId && conn.status === "active") {
      const token = await accessToken(conn);
      await requestJson(`${xero.XERO_CONNECTIONS_URL}/${encodeURIComponent(xeroConnectionId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    const refreshed = await loadConnection(connectionId);
    if (refreshed?.refresh) {
      await requestJson(xero.XERO_REVOKE_URL, {
        method: "POST",
        headers: {
          Authorization: xero.basicAuth(app.clientId, app.clientSecret),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: refreshed.refresh }),
      });
    }
  } catch (e) {
    console.error("Releasing the Xero connection failed", (e as Error).message);
  }
}

/** "Refresh now" on the Shop page. */
export async function queueShopSync(workspaceId: string): Promise<boolean> {
  const conn = await activeConnection(workspaceId, "shopify");
  if (!conn) return false;
  await enqueueJob({
    connectionId: conn.id,
    kind: "shopify_sync",
    payload: { full: false },
    dedupe: `shopify:${conn.id}:sync`,
  });
  return true;
}
