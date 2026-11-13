import { timingSafeEqual } from "node:crypto";
import { log } from "@/lib/ops/log";
import { runPurge } from "@/server/privacy/run-purge";

export const maxDuration = 60;

/** Called daily by pg_cron (via pg_net) with the shared JOBS_SECRET, like the other jobs. */
function authorised(req: Request): boolean {
  const secret = process.env.JOBS_SECRET;
  if (!secret || secret.length < 32) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.JOBS_SECRET) return Response.json({ error: "Jobs are not configured" }, { status: 503 });
  if (!authorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const result = await runPurge();
    log.info("purge_done", result);
    return Response.json(result);
  } catch (e) {
    log.error("purge_failed", { error: e });
    return Response.json({ error: "Job failed" }, { status: 500 });
  }
}
