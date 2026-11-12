import { timingSafeEqual } from "node:crypto";
import { runOutbox } from "@/server/jobs/run-outbox";

/**
 * Called every minute by pg_cron (via pg_net) with the shared JOBS_SECRET.
 * Anyone else gets a 401, and the comparison does not leak timing.
 */
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
    const result = await runOutbox(25);
    return Response.json(result);
  } catch (e) {
    console.error("outbox job failed", (e as Error).message);
    return Response.json({ error: "Job failed" }, { status: 500 });
  }
}
