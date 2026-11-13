import { NextResponse, type NextRequest } from "next/server";
import { classifyPath } from "@/lib/routing";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Runs before every page:
 * 1. Addresses that can never exist get a real 404 status (not a 200 "soft 404").
 * 2. The Supabase session is refreshed.
 * 3. Signed-out visitors to a workspace or the building screen are redirected to sign in
 *    on the server, keeping where they were going.
 * Membership itself is checked by row-level security when the page loads.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const kind = classifyPath(pathname);

  if (kind === "not-found") {
    return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  }

  const { response, userId } = await updateSession(request);

  const needsSession = kind === "workspace" || pathname === "/welcome";
  if (needsSession && !userId) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(login);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except build assets, images, the service worker and the payment webhooks
    // (webhooks carry no session and must not be delayed).
    "/((?!_next/static|_next/image|favicon.ico|sw.js|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
