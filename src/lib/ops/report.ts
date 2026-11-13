import { scrubText } from "./log";

export { redact, scrubText } from "./log";

/**
 * Error reporting to Sentry over its plain HTTP envelope API, with no SDK: nothing is added to any page's
 * JavaScript, and what is sent is limited to the error's type, a scrubbed message, the route (with token-like
 * path pieces hidden) and the method. No request body, cookies, headers or user details ever leave.
 * Unverified against a live Sentry project until the owner supplies SENTRY_DSN.
 */
export function parseDsn(dsn: string): { key: string; host: string; project: string } | null {
  const m = /^https:\/\/([A-Za-z0-9]+)@([A-Za-z0-9.-]+)\/(\d+)$/.exec(dsn.trim());
  return m ? { key: m[1]!, host: m[2]!, project: m[3]! } : null;
}

/** A path with anything that looks like a link token (/p/<token>, /portal/<token>) hidden. */
export function safeRoute(path: string): string {
  return scrubText(
    path
      .split("?")[0]!
      .split("/")
      .map((seg) => (seg.length >= 20 ? ":id" : seg))
      .join("/"),
  ).slice(0, 200);
}

export function buildSentryEnvelope(
  dsn: string,
  i: { error: unknown; route: string; method: string; release?: string; env?: string },
  now: Date = new Date(),
  newId: () => string = () => crypto.randomUUID().replace(/-/g, ""),
): { url: string; headers: Record<string, string>; body: string } | null {
  const d = parseDsn(dsn);
  if (!d) return null;
  const err = i.error instanceof Error ? i.error : new Error(typeof i.error === "string" ? i.error : "Unknown error");
  const eventId = newId();
  const event = {
    event_id: eventId,
    timestamp: Math.floor(now.getTime() / 1000),
    platform: "node",
    level: "error",
    ...(i.env ? { environment: i.env } : {}),
    ...(i.release ? { release: i.release } : {}),
    tags: { route: safeRoute(i.route), method: i.method },
    exception: { values: [{ type: err.name || "Error", value: scrubText(err.message).slice(0, 500) }] },
  };
  const body = [
    JSON.stringify({ event_id: eventId, dsn, sent_at: now.toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  return {
    url: `https://${d.host}/api/${d.project}/envelope/`,
    headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${d.key}, sentry_client=ledgerly/1` },
    body,
  };
}

/** Fire and forget: reporting must never break or slow the request that failed. */
export async function reportError(i: { error: unknown; route: string; method: string }): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  const envelope = buildSentryEnvelope(dsn, { ...i, release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12), env: process.env.VERCEL_ENV ?? process.env.NODE_ENV });
  if (!envelope) return;
  try {
    await fetch(envelope.url, { method: "POST", headers: envelope.headers, body: envelope.body, signal: AbortSignal.timeout(3000) });
  } catch {
    // Reporting is best effort.
  }
}
