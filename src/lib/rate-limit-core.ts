import { createHash } from "node:crypto";

/**
 * Fixed-window rate limiting backed by public.hit_rate_limit (see migration 0005).
 * This file holds the logic; src/lib/rate-limit.ts wires it to the database.
 */

export type LimitKind = "otp-email" | "otp-ip" | "otp-verify" | "oauth-ip";

type RpcResult = { data: boolean | null; error: { message: string } | null };
type RpcCall = (args: { p_bucket: string; max_hits: number; window_seconds: number }) => Promise<RpcResult>;

/** "otp-email:<sha256>". The raw email or IP never leaves this server. */
export function bucketFor(kind: LimitKind, id: string): string {
  return `${kind}:${createHash("sha256").update(id.trim().toLowerCase()).digest("hex")}`;
}

export function createRateLimiter(opts: {
  /** null when the server key is not configured. */
  call: RpcCall | null;
  production: boolean;
  warn?: (message: string) => void;
}) {
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  return async function rateLimit(
    kind: LimitKind,
    id: string,
    max: number,
    windowSeconds: number,
  ): Promise<boolean> {
    if (!opts.call) {
      warn(
        opts.production
          ? "Rate limiting unavailable: SUPABASE_SERVICE_ROLE_KEY is not set. Refusing the request."
          : "Rate limiting skipped in development: SUPABASE_SERVICE_ROLE_KEY is not set.",
      );
      return !opts.production;
    }
    const { data, error } = await opts.call({
      p_bucket: bucketFor(kind, id),
      max_hits: max,
      window_seconds: windowSeconds,
    });
    if (error || data === null) {
      warn(`Rate limit check failed (${kind}).`);
      return !opts.production;
    }
    return data;
  };
}
