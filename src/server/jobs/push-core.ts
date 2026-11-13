export type PushRow = { notification_id: string; user_id: string; title: string; href: string | null; endpoint: string; p256dh: string; auth: string };
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };

/**
 * One pass of the push worker. The database has already claimed these rows (each notification is pushed
 * once). A subscription the push service reports gone (404 or 410) is deleted; any other error keeps it.
 */
export async function processPush(deps: {
  claim: () => Promise<PushRow[]>;
  send: (to: PushTarget, payload: string) => Promise<void>;
  drop: (endpoint: string) => Promise<void>;
}): Promise<{ sent: number; dropped: number; failed: number }> {
  let sent = 0;
  let dropped = 0;
  let failed = 0;
  for (const row of await deps.claim()) {
    try {
      await deps.send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify({ title: row.title, href: row.href }));
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await deps.drop(row.endpoint);
        dropped++;
      } else failed++;
    }
  }
  return { sent, dropped, failed };
}
