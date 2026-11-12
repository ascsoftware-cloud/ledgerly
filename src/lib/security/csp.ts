/**
 * Security headers sent with every response (wired up in next.config.ts).
 *
 * Scripts use 'unsafe-inline' rather than per-request nonces: in this Next.js version
 * nonces force every page to render dynamically and are incompatible with cache
 * components, which would cost the landing page its speed. Everything else is strict.
 * To be revisited (hash/SRI-based policy) in the Phase 7 security pass.
 */

export type CspOptions = {
  /** NEXT_PUBLIC_SUPABASE_URL, or "" before Supabase is connected. */
  supabaseUrl: string;
  dev: boolean;
};

/** Returns the https and wss origins for a valid https URL, otherwise nothing. */
function supabaseOrigins(url: string): string[] {
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(url)) return [];
  const { host } = new URL(url);
  return [`https://${host}`, `wss://${host}`];
}

export function buildCsp({ supabaseUrl, dev }: CspOptions): string {
  const supabase = supabaseOrigins(supabaseUrl);
  const directives: string[][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "blob:", "data:", ...supabase.slice(0, 1)],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...supabase],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    // PayFast checkout is a form POST to its hosted page (see pay-buttons.tsx).
    ["form-action", "'self'", "https://www.payfast.co.za", "https://sandbox.payfast.co.za"],
    ["frame-ancestors", "'none'"],
    ...(dev ? [] : [["upgrade-insecure-requests"]]),
  ];
  return directives.map((d) => d.join(" ")).join("; ");
}

export function securityHeaders(opts: CspOptions): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: buildCsp(opts) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  ];
}
