import { createBrowserClient } from "@supabase/ssr";
import { requirePublicEnv } from "./env";

/** Supabase client for Client Components. Acts as the signed-in user; RLS applies. */
export function createClient() {
  const { url, publishableKey } = requirePublicEnv();
  return createBrowserClient(url, publishableKey);
}
