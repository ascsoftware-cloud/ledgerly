/**
 * One way to call outside APIs: a timeout on every request, JSON in and out, and a result
 * object instead of a thrown error, so callers decide what a failure means.
 * Retrying is the job queue's work, not this function's: it only reports how long the other
 * side asked us to wait (Retry-After) so the queue can schedule the next attempt.
 */

export type HttpResult<T = unknown> = {
  ok: boolean;
  status: number;
  body: T;
  /** Seconds to wait before retrying, from Retry-After on a 429 or 503. */
  retryAfter: number | null;
  /** Network failure or timeout (status 0). */
  networkError: boolean;
};

export type Fetcher = typeof fetch;

export function parseRetryAfter(value: string | null, now: Date = new Date()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

export async function requestJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number; fetcher?: Fetcher } = {},
): Promise<HttpResult<T>> {
  const { timeoutMs = 20_000, fetcher = fetch, ...rest } = init;
  let res: Response;
  try {
    res = await fetcher(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, status: 0, body: null as T, retryAfter: null, networkError: true };
  }
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  } else {
    body = null;
  }
  const retryAfter =
    res.status === 429 || res.status === 503
      ? parseRetryAfter(res.headers.get("retry-after"))
      : null;
  return { ok: res.ok, status: res.status, body: body as T, retryAfter, networkError: false };
}

/** Whether a failed call is worth retrying later (as opposed to a request we built wrong). */
export function isTransient(r: Pick<HttpResult, "status" | "networkError">): boolean {
  return r.networkError || r.status === 429 || r.status === 408 || r.status >= 500;
}

/** A short, log-safe description of a failed call. Never includes request headers or secrets. */
export function describeFailure(service: string, r: HttpResult): string {
  if (r.networkError) return `${service} did not respond`;
  const body = r.body;
  let detail = "";
  if (typeof body === "string") detail = body;
  else if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const candidates = [
      b.message,
      b.Message,
      b.detail,
      b.error_description,
      b.error,
      b.title,
      b.Detail,
    ];
    detail = String(candidates.find((x) => typeof x === "string" && x) ?? "");
    if (!detail && Array.isArray(b.Elements)) {
      // Xero validation errors
      const msgs = (b.Elements as { ValidationErrors?: { Message?: string }[] }[])
        .flatMap((e) => e.ValidationErrors ?? [])
        .map((e) => e.Message)
        .filter(Boolean);
      detail = msgs.join("; ");
    }
    if (!detail && Array.isArray(b.errors)) {
      detail = (b.errors as { message?: string }[])
        .map((e) => e.message)
        .filter(Boolean)
        .join("; ");
    }
  }
  return `${service} returned ${r.status}${detail ? `: ${detail.replace(/\s+/g, " ").slice(0, 300)}` : ""}`;
}

/** Cents to a two-decimal amount for APIs that take rands as numbers. */
export function centsToRands(cents: number): number {
  return Math.round(cents) / 100;
}

/** "123.45", 123.45 or "123.4" to cents, without float drift. Null when it is not an amount. */
export function randsToCents(value: unknown): number | null {
  const s =
    typeof value === "number" ? value.toFixed(2) : typeof value === "string" ? value.trim() : "";
  const m = /^(-)?(\d+)(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  const whole = BigInt(m[2]!);
  const frac = (m[3] ?? "").padEnd(4, "0");
  // Round to cents, half away from zero, from up to 4 decimals.
  const tenThousandths = whole * 10000n + BigInt(frac);
  const cents = (tenThousandths + 50n) / 100n;
  return Number(m[1] ? -cents : cents);
}
