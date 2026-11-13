import { timingSafeEqual } from "node:crypto";
import { runPush } from "@/server/jobs/run-push";

/** Called every minute by pg_cron (via pg_net) with the shared JOBS_SECRET, like the outbox job. */
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
    return Response.json(await runPush(50));
  } catch (e) {
    console.error("push job failed", (e as Error).message);
    return Response.json({ error: "Job failed" }, { status: 500 });
  }
}
