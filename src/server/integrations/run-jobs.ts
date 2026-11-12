import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushDocument, pushPayment, voidDocument } from "./accounting-service";
import { track } from "./courier-guy-service";
import { finishArgs, type JobOutcome } from "./job-types";
import { refresh, runSync } from "./shopify-service";

const jobRow = z.object({
  id: z.uuid(),
  connection_id: z.uuid(),
  kind: z.enum([
    "push_document",
    "void_document",
    "push_payment",
    "shopify_sync",
    "shopify_refresh",
    "track_shipment",
  ]),
  entity_id: z.uuid().nullable(),
  payload: z.record(z.string(), z.unknown()).catch({}),
});
type Job = z.infer<typeof jobRow>;

async function handle(job: Job): Promise<JobOutcome> {
  switch (job.kind) {
    case "push_document":
      return job.entity_id ? pushDocument(job.connection_id, job.entity_id) : { ok: true };
    case "void_document":
      return job.entity_id ? voidDocument(job.connection_id, job.entity_id) : { ok: true };
    case "push_payment":
      return job.entity_id ? pushPayment(job.connection_id, job.entity_id) : { ok: true };
    case "shopify_sync":
      return runSync(job.connection_id, job.payload.full === true);
    case "shopify_refresh":
      return refresh(job.connection_id, {
        kind: String(job.payload.kind ?? ""),
        id: String(job.payload.id ?? ""),
      });
    case "track_shipment":
      return job.entity_id ? track(job.entity_id, job.connection_id) : { ok: true };
  }
}

/**
 * Drains due integration jobs. Runs from /api/jobs/integrations (pg_cron, every minute when
 * something is due). Each job's failure is recorded on the job; one bad job never stops the rest.
 * Stops claiming new work after `budgetMs` so a serverless request finishes in time.
 */
export async function runIntegrationJobs(limit = 10, budgetMs = 45_000) {
  const db = createAdminClient();
  const started = Date.now();
  await db.rpc("release_stuck_integration_jobs");
  let done = 0;
  let failed = 0;
  while (Date.now() - started < budgetMs) {
    const { data, error } = await db.rpc("claim_integration_jobs", { p_limit: Math.min(limit, 5) });
    if (error) throw new Error(`claim_integration_jobs failed: ${error.code}`);
    const jobs = z
      .array(jobRow)
      .catch([])
      .parse(data ?? []);
    if (!jobs.length) break;
    for (const job of jobs) {
      let outcome: JobOutcome;
      try {
        outcome = await handle(job);
      } catch (e) {
        outcome = { ok: false, error: (e as Error).message || "Job failed" };
      }
      const f = finishArgs(outcome);
      await db.rpc("finish_integration_job", {
        p_id: job.id,
        p_ok: f.ok,
        p_error: f.error,
        p_retry_in: f.retryIn,
      });
      if (outcome.ok) done++;
      else {
        failed++;
        console.error("integration job failed", {
          kind: job.kind,
          error: outcome.error.slice(0, 200),
        });
      }
    }
    if (done + failed >= limit) break;
  }
  return { done, failed };
}
