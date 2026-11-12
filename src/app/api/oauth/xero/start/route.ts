import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site-url";
import { requireWorkspace } from "@/lib/workspace";
import { xeroApp } from "@/server/integrations/env";
import {
  cookieOptions,
  encodePending,
  newState,
  OAUTH_COOKIE,
} from "@/server/integrations/oauth-state";
import { authorizeUrl } from "@/server/integrations/xero";

/** "Connect Xero": owner or admin only. Sends the browser to Xero's consent screen. */
export async function GET(request: NextRequest) {
  const ws = request.nextUrl.searchParams.get("ws") ?? "";
  const ctx = await requireWorkspace(ws);
  const back = `${siteUrl()}/${ctx.workspace.slug}/settings/integrations`;
  if (ctx.role !== "owner" && ctx.role !== "admin")
    return NextResponse.redirect(`${back}?error=role`, 303);
  const app = xeroApp();
  if (!app) return NextResponse.redirect(`${back}?error=xero-not-configured`, 303);

  const state = newState();
  const res = NextResponse.redirect(
    authorizeUrl({
      clientId: app.clientId,
      redirectUri: `${siteUrl()}/api/oauth/xero/callback`,
      state,
    }),
    303,
  );
  res.cookies.set(
    OAUTH_COOKIE,
    encodePending({ state, ws: ctx.workspace.slug, provider: "xero" }),
    cookieOptions(siteUrl().startsWith("https://")),
  );
  return res;
}
