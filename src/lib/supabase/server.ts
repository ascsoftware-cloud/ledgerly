import "server-only";
import { createServerClient as createSsrClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requirePublicEnv } from "./env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Acts as the signed-in user (from the session cookie); RLS applies.
 */
export async function createServerClient() {
  const { url, publishableKey } = requirePublicEnv();
  const cookieStore = await cookies();

  return createSsrClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which cannot set cookies.
          // The proxy refreshes the session on every request, so this is safe to skip.
        }
      },
    },
  });
}
