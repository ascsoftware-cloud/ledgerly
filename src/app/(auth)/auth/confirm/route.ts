import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { safeNext } from "@/lib/safe-next";
import { createServerClient } from "@/lib/supabase/server";

const query = z.object({
  token_hash: z.string().min(10).max(200),
  type: z.enum(["email", "magiclink", "signup", "invite"]),
});

/** The custom email template links here with a token hash (works on any device). */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const parsed = query.safeParse({
    token_hash: url.searchParams.get("token_hash"),
    type: url.searchParams.get("type"),
  });

  if (parsed.success) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.verifyOtp(parsed.data);
    if (!error) return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
