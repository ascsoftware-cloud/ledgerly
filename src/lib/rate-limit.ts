import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "./rate-limit-core";

/**
 * Uses the service-role client for exactly one thing: calling public.hit_rate_limit,
 * which no signed-in or signed-out user may call. It reads and writes nothing else.
 */
function rpc() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const admin = createAdminClient();
  return async (args: { p_bucket: string; max_hits: number; window_seconds: number }) => {
    const { data, error } = await admin.rpc("hit_rate_limit", args);
    return { data: typeof data === "boolean" ? data : null, error };
  };
}

export const rateLimit = createRateLimiter({
  call: rpc(),
  production: process.env.NODE_ENV === "production",
});
