import "server-only";
import { sendNotification, setVapidDetails } from "web-push";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPush, type PushRow } from "./push-core";

const rowSchema = z.object({
  notification_id: z.uuid(),
  user_id: z.uuid(),
  title: z.string(),
  href: z.string().nullable(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
});

/** Sends web push for new notifications. Without VAPID keys it does nothing (push is optional). */
export async function runPush(limit = 50) {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return { sent: 0, dropped: 0, failed: 0, configured: false };
  setVapidDetails(subject, pub, priv);
  const db = createAdminClient();
  const result = await processPush({
    claim: async () => {
      const { data, error } = await db.rpc("claim_push", { p_limit: limit });
      if (error) throw new Error(`claim_push failed: ${error.code}`);
      return z.array(rowSchema).parse(data ?? []) as PushRow[];
    },
    send: async (to, payload) => {
      await sendNotification(to, payload, { TTL: 3600, urgency: "normal" });
    },
    drop: async (endpoint) => {
      await db.rpc("drop_push_subscription", { p_endpoint: endpoint });
    },
  });
  return { ...result, configured: true };
}
