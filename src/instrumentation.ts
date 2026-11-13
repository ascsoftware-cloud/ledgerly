import { log } from "@/lib/ops/log";
import { reportError, safeRoute } from "@/lib/ops/report";

/** Next.js calls this for every error thrown while serving a request. Logged (scrubbed) and, with SENTRY_DSN set, reported. */
export async function onRequestError(error: unknown, request: { path: string; method: string }) {
  log.error("request_error", { route: safeRoute(request.path), method: request.method, error });
  await reportError({ error, route: request.path, method: request.method });
}
