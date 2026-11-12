import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { connectionSecrets } from "./checkout";

/**
 * Removes Ledgerly's webhook from the business's Yoco account (Yoco allows only a few per
 * account, so reconnecting must not leave old ones behind). Best effort: a failure here
 * never blocks connecting or disconnecting. Only acts on a connection of `workspaceId`.
 */
export async function removeYocoWebhook(connectionId: string, workspaceId: string): Promise<void> {
  if (!z.uuid().safeParse(connectionId).success) return;
  const secrets = await connectionSecrets(connectionId);
  if (!secrets || secrets.workspace_id !== workspaceId || secrets.provider !== "yoco" || !secrets.secret) return;
  const { data } = await createAdminClient()
    .from("payment_connections")
    .select("webhook_id")
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const webhookId = data?.webhook_id as string | null | undefined;
  if (!webhookId || !/^[A-Za-z0-9_-]{1,100}$/.test(webhookId)) return;
  await fetch(`https://payments.yoco.com/api/webhooks/${webhookId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secrets.secret}` },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
}

/** After a new Yoco key took over: drop the old webhook, then delete the old keys. */
export async function retireReplacedConnection(connectionId: string, workspaceId: string): Promise<void> {
  await removeYocoWebhook(connectionId, workspaceId);
  await createAdminClient().rpc("purge_connection_secrets", { p_connection: connectionId });
}
