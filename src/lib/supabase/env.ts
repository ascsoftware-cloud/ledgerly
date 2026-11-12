/**
 * Reads and checks the Supabase settings. Errors name the variable that is wrong
 * and never print a value, so a secret cannot leak into logs.
 */

type Env = Record<string, string | undefined>;

export type PublicEnv = { url: string; publishableKey: string };

/**
 * The browser-safe settings, or null when Supabase is not configured yet
 * (the marketing pages and onboarding still work without it).
 */
export function readPublicEnv(env: Env): PublicEnv | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!url && !publishableKey) return null;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!publishableKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(url)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an https URL such as https://xyz.supabase.co");
  }
  if (publishableKey.startsWith("sb_secret_")) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key. Use the publishable key; secrets must never be public.",
    );
  }
  return { url: url.replace(/\/$/, ""), publishableKey };
}

export function readServiceRoleKey(env: Env): string {
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return key;
}

/**
 * Next.js only inlines NEXT_PUBLIC_* variables when they are referenced by their
 * full name, so they are listed out here rather than passing `process.env` whole.
 */
export function publicEnv(): PublicEnv | null {
  return readPublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function requirePublicEnv(): PublicEnv {
  const env = publicEnv();
  if (!env) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return env;
}
