import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site-url";
import { requireWorkspace } from "@/lib/workspace";
import { shopifyApp } from "@/server/integrations/env";
import {
  cookieOptions,
  encodePending,
  newState,
  OAUTH_COOKIE,
} from "@/server/integrations/oauth-state";
import { authorizeUrl, normaliseShop } from "@/server/integrations/shopify";

/** "Connect Shopify": owner or admin types the store address; we send them to Shopify to approve. */
export async function GET(request: NextRequest) {
  const ws = request.nextUrl.searchParams.get("ws") ?? "";
  const ctx = await requireWorkspace(ws);
  const back = `${siteUrl()}/${ctx.workspace.slug}/settings/integrations`;
  if (ctx.role !== "owner" && ctx.role !== "admin")
    return NextResponse.redirect(`${back}?error=role`, 303);
  const app = shopifyApp();
  if (!app) return NextResponse.redirect(`${back}?error=shopify-not-configured`, 303);
  const shop = normaliseShop(request.nextUrl.searchParams.get("shop") ?? "");
  if (!shop) return NextResponse.redirect(`${back}?error=shop`, 303);

  const state = newState();
  const res = NextResponse.redirect(
    authorizeUrl({
      shop,
      clientId: app.clientId,
      redirectUri: `${siteUrl()}/api/oauth/shopify/callback`,
      state,
    }),
    303,
  );
  res.cookies.set(
    OAUTH_COOKIE,
    encodePending({ state, ws: ctx.workspace.slug, provider: "shopify", shop }),
    cookieOptions(siteUrl().startsWith("https://")),
  );
  return res;
}
