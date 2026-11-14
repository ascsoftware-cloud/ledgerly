/**
 * Where to send someone after sign-in. Only same-site paths are allowed, so a crafted
 * link like /login?next=https://evil.example cannot bounce a fresh session elsewhere.
 */
export function safeNext(next: string | null | undefined, fallback = "/welcome"): string {
  if (!next || next.length > 200) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  // Backslashes, control characters and encoded slashes are read as "//" by some browsers.
  if (/[\\\u0000-\u001f\u007f]/.test(next) || /%2f|%5c/i.test(next)) return fallback;
  // Never loop back into the sign-in flow itself. (The Shopify connect page is not part of sign-in: it needs a session.)
  if (/^\/(auth|login)(\/|\?|$)/.test(next) && !/^\/auth\/shopify\/connect\?/.test(next)) return fallback;
  return next;
}
