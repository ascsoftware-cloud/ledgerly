import { log } from "@/lib/ops/log";
import { reportError } from "@/lib/ops/report";

/** Next.js calls this for every error thrown while serving a request. Logged (scrubbed) and, with SENTRY_DSN set, reported. */
export async function onRequestError(error: unknown, request: { path: string; method: string }) {
  log.error("request_error", { route: request.path.split("?")[0]?.slice(0, 200), method: request.method, error });
  await reportError({ error, route: request.path, method: request.method });
}
