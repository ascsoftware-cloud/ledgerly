import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readServiceRoleKey, requirePublicEnv } from "./env";

/**
 * Service-role client. BYPASSES row-level security.
 *
 * Only payment webhooks, scheduled workers and account deletion may import this file;
 * an ESLint rule (see eslint.config.mjs) fails the build anywhere else.
 * Every use must scope its own queries by workspace, because the database will not.
 */
export function createAdminClient() {
  const { url } = requirePublicEnv();
  return createClient(url, readServiceRoleKey(process.env), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
