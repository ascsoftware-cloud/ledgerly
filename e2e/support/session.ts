import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

/**
 * Test-only sign-in. Uses the service-role key to create a throwaway user and a
 * one-time sign-in link (no email is sent), then opens the app's own /auth/confirm
 * route with it, exactly as the emailed link would. Requires SUPABASE_SERVICE_ROLE_KEY
 * in .env.local; tests that need it are skipped otherwise.
 */

export const hasAdminKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);

export function admin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function testEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@ledgerly-test.invalid`;
}

/** Signs the browser in as `email` (creating the user if needed) and lands on `next`. */
export async function signIn(page: Page, email: string, next = "/welcome", fullName?: string) {
  const db = admin();
  const { data, error } = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { data: fullName ? { full_name: fullName } : undefined },
  });
  if (error || !data.properties?.hashed_token) throw new Error(`generateLink failed: ${error?.message}`);
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email&next=${encodeURIComponent(next)}`,
  );
  return data.user.id;
}

/** Removes the test user and every workspace they created. */
export async function cleanUp(userIds: string[]) {
  const db = admin();
  for (const id of userIds) {
    await db.from("workspaces").delete().eq("created_by", id);
    await db.auth.admin.deleteUser(id);
  }
}
