import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site-url";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { xeroApp } from "@/server/integrations/env";
import { requestJson } from "@/server/integrations/http";
import {
  decodePending,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  sameState,
} from "@/server/integrations/oauth-state";
import {
  basicAuth,
  pickTenant,
  tokenResponse,
  XERO_CONNECTIONS_URL,
  XERO_TOKEN_URL,
} from "@/server/integrations/xero";

/**
 * Xero returns here after consent. Checks the state cookie, swaps the code for tokens, finds the
 * organisation that was just authorised, and saves the connection as the signed-in person
 * (the database checks they are an owner or admin of the workspace that started this).
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
  if (
    !pending ||
    pending.provider !== "xero" ||
    !sameState(url.searchParams.get("state"), pending.state)
  ) {
    return done(pending?.ws ?? null, "error=state");
  }
  if (url.searchParams.get("error")) return done(pending.ws, "error=xero-declined");
  const code = url.searchParams.get("code");
  const app = xeroApp();
  if (!code || code.length > 2000 || !app) return done(pending.ws, "error=xero");

  const ctx = await requireWorkspace(pending.ws);
  if (ctx.role !== "owner" && ctx.role !== "admin") return done(pending.ws, "error=role");

  const tokenRes = await requestJson(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(app.clientId, app.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${siteUrl()}/api/oauth/xero/callback`,
    }),
  });
  const tokens = tokenResponse.safeParse(tokenRes.body);
  if (!tokenRes.ok || !tokens.success) {
    console.error("Xero token exchange failed", { status: tokenRes.status });
    return done(pending.ws, "error=xero");
  }
  const conns = await requestJson(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${tokens.data.access_token}`, Accept: "application/json" },
  });
  const tenant = conns.ok ? pickTenant(conns.body) : null;
  if (!tenant) return done(pending.ws, "error=xero-no-org");

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("connect_integration", {
    p_workspace: ctx.workspace.id,
    p_provider: "xero",
    p_mode: "live",
    p_external_id: tenant.tenantId,
    p_external_name: tenant.name,
    p_settings: { _xero_connection_id: tenant.connectionId },
    p_secret: tokens.data.access_token,
    p_refresh: tokens.data.refresh_token,
    p_expires_in: tokens.data.expires_in,
  });
  if (error) {
    console.error("Saving the Xero connection failed", { code: error.code });
    return done(pending.ws, "error=save");
  }
  return done(pending.ws, "connected=xero");
}
