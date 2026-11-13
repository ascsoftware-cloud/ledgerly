import { connection } from "next/server";
import { log } from "@/lib/ops/log";
import { createServerClient } from "@/lib/supabase/server";

/**
 * For an uptime monitor: 200 when the app and its database answer, 503 when the database does not.
 * Says nothing about secrets, versions of libraries or who is signed in.
 */
export async function GET() {
  await connection();
  let db: "ok" | "down" = "down";
  try {
    const supabase = await createServerClient();
    // A cheap anonymous call that touches the database and returns a yes/no (migration 0038).
    const { error } = await supabase.rpc("show_footer_for_document", { p_token: "health-check" });
    db = error ? "down" : "ok";
  } catch {
    db = "down";
  }
  if (db === "down") log.error("health_check_failed", { db });
  return Response.json(
    { status: db === "ok" ? "ok" : "degraded", db, commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    { status: db === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
