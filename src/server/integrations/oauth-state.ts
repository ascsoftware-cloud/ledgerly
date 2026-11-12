import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * OAuth "state": a random value in an httpOnly cookie that must come back unchanged in the
 * callback, so a callback can only finish a connect this browser started. The cookie also
 * remembers which workspace asked; the callback re-checks the person's role there.
 */

export const OAUTH_COOKIE = "ldg_oauth";
export const OAUTH_COOKIE_PATH = "/api/oauth";
export const OAUTH_MAX_AGE = 600;

export const pendingSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
  ws: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(40),
  provider: z.enum(["xero", "shopify"]),
  shop: z.string().optional(),
});
export type Pending = z.infer<typeof pendingSchema>;

export function newState(): string {
  return randomBytes(32).toString("base64url");
}

export function encodePending(p: Pending): string {
  return Buffer.from(JSON.stringify(p)).toString("base64url");
}

export function decodePending(raw: string | undefined): Pending | null {
  if (!raw) return null;
  try {
    const parsed = pendingSchema.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function sameState(a: string | null, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_MAX_AGE,
  };
}
