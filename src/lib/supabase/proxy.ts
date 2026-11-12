import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "./env";

/**
 * Refreshes the signed-in session on each request so server-rendered pages never
 * see an expired token. Follows Supabase's Next.js guide for this Next.js version.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = publicEnv();
  if (!env) return response; // Supabase not configured: nothing to refresh.

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Do not add code between creating the client and getClaims(): doing so can
  // cause users to be signed out at random.
  await supabase.auth.getClaims();

  return response;
}
