import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site-url";
import { requireWorkspace } from "@/lib/workspace";
import { shopifyApp } from "@/server/integrations/env";
import { requestJson } from "@/server/integrations/http";
import {
  decodePending,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  sameState,
} from "@/server/integrations/oauth-state";
import {
  codeExchangeBody,
  missingScopes,
  normaliseShop,
  tokenResponse,
  verifyOAuthCallback,
} from "@/server/integrations/shopify";
import { afterConnect, saveShopifyConnection } from "@/server/integrations/shopify-service";

/**
 * Shopify returns here after the merchant approves. Checks, in order: Shopify's HMAC over the
 * query, the shop address, and our state cookie. Then swaps the code for an expiring offline
 * token and saves the connection for the signed-in owner or admin (the database checks the role).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const pending = decodePending(request.cookies.get(OAUTH_COOKIE)?.value);
  const done = (ws: string | null, query: string) => {
    const res = NextResponse.redirect(
      ws ? `${siteUrl()}/${ws}/settings/integrations?${query}` : `${siteUrl()}/`,
      303,
    );
    res.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  const app = shopifyApp();
  if (!app || !verifyOAuthCallback(url.searchParams, app.clientSecret))
    return done(pending?.ws ?? null, "error=shopify");
  const shop = normaliseShop(url.searchParams.get("shop") ?? "");
  if (
    !pending ||
    pending.provider !== "shopify" ||
    !shop ||
    shop !== pending.shop ||
    !sameState(url.searchParams.get("state"), pending.state)
  ) {
    // An install started from Shopify itself has no Ledgerly session to attach to.
    return done(pending?.ws ?? null, "error=state");
  }
  const code = url.searchParams.get("code");
  if (!code || code.length > 500) return done(pending.ws, "error=shopify");

  const ctx = await requireWorkspace(pending.ws);
  if (ctx.role !== "owner" && ctx.role !== "admin") return done(pending.ws, "error=role");

  const res = await requestJson(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: codeExchangeBody({ clientId: app.clientId, clientSecret: app.clientSecret, code }),
  });
  const tokens = tokenResponse.safeParse(res.body);
  if (!res.ok || !tokens.success) {
    console.error("Shopify token exchange failed", { status: res.status });
    return done(pending.ws, "error=shopify");
  }
  if (missingScopes(tokens.data.scope).length) return done(pending.ws, "error=shopify-scopes");

  const saved = await saveShopifyConnection({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    shop,
    accessToken: tokens.data.access_token,
    refreshToken: tokens.data.refresh_token ?? null,
    expiresIn: tokens.data.expires_in ?? null,
  });
  if (!saved.ok) {
    console.error("Saving the Shopify connection failed", { code: saved.code });
    return done(pending.ws, saved.code === "LDG03" ? "error=shop-taken" : "error=save");
  }
  const warning = await afterConnect(saved.id).catch(
    () => "Live updates could not be switched on.",
  );
  return done(pending.ws, warning ? "connected=shopify&warn=webhooks" : "connected=shopify");
}
