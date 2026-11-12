/** What a job handler reports back to the queue. */
export type JobOutcome =
  | { ok: true; continueIn?: number }
  | {
      ok: false;
      error: string;
      /** Seconds until the next try (Retry-After). */
      retryIn?: number;
      /** Retrying will not help until the person fixes something: stop now. */
      stop?: boolean;
      transient?: boolean;
    };

/** The queue's arguments to finish_integration_job for an outcome. */
export function finishArgs(o: JobOutcome): {
  ok: boolean;
  error: string | null;
  retryIn: number | null;
} {
  if (o.ok) return { ok: true, error: null, retryIn: o.continueIn ?? null };
  if (o.stop) return { ok: false, error: o.error, retryIn: 0 };
  return {
    ok: false,
    error: o.error,
    retryIn: o.retryIn && o.retryIn > 0 ? Math.min(o.retryIn, 3600) : null,
  };
}
