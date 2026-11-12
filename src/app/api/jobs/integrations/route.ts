import { timingSafeEqual } from "node:crypto";
import { runIntegrationJobs } from "@/server/integrations/run-jobs";

// Long enough for a few slow API calls; the worker stops claiming work before this runs out.
export const maxDuration = 60;

/** Same shared-secret check as /api/jobs/outbox: pg_cron sends JOBS_SECRET. */
function authorised(req: Request): boolean {
  const secret = process.env.JOBS_SECRET;
  if (!secret || secret.length < 32) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.JOBS_SECRET)
    return Response.json({ error: "Jobs are not configured" }, { status: 503 });
  if (!authorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  try {
    return Response.json(await runIntegrationJobs(20, 45_000));
  } catch (e) {
    console.error("integrations job failed", (e as Error).message);
    return Response.json({ error: "Job failed" }, { status: 500 });
  }
}
