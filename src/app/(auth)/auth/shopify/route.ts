import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/ops/log";
import { siteUrl } from "@/lib/site-url";
import { shopifyApp } from "@/server/integrations/env";
import { installRequestShop } from "@/server/integrations/shopify";

/**
 * The Shopify app's "App URL". A merchant who installs Ledgerly from Shopify (the App Store listing or an install
 * link) arrives here with a signed request. We check it really came from Shopify, then send the person on to
 * choose which Ledgerly business the store belongs to (signing in first if needed).
 */
export async function GET(request: NextRequest) {
  const app = shopifyApp();
  if (!app) return new NextResponse("Shopify is not set up for Ledgerly yet.", { status: 503 });
  const shop = installRequestShop(request.nextUrl.searchParams, app.clientSecret);
  if (!shop) {
    log.warn("shopify_install_request_refused", {});
    return new NextResponse("This install link is not valid or has expired. Start again from Shopify.", { status: 400 });
  }
  return NextResponse.redirect(`${siteUrl()}/auth/shopify/connect?${new URLSearchParams({ shop })}`, 303);
}
