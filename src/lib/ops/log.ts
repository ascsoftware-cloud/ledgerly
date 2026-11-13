/**
 * Structured logging: one JSON line per event, with anything that looks like a secret or personal detail hidden
 * by field name. Vercel keeps these lines; never put customer data in `fields` on purpose, but if it slips in by
 * name (email, phone, token…) it is hidden here.
 */
const HIDDEN = "[hidden]";
// A field is hidden when one of its WORDS names a secret or a personal detail: "accessToken", "user_email",
// "x-api-key", "cellNumber". Words only, so "passed", "cancelled" and "compass" are left alone.
const SECRET_WORDS = new Set(["pass", "password", "passphrase", "secret", "token", "authorization", "cookie", "key", "email", "phone", "cell", "signature", "session", "credential", "credentials"]);
function isSecretKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((w) => SECRET_WORDS.has(w) || SECRET_WORDS.has(w.replace(/s$/, "")));
}
// Ordinary UUIDs are kept: they are needed to trace an error and are not secret by themselves.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_STRING = 1000;
const MAX_DEPTH = 6;

/** Free text: emails, bearer values and long token-like strings removed. */
export function scrubText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, HIDDEN)
    .replace(/Bearer\s+[\w.~+/=-]+/gi, `Bearer ${HIDDEN}`)
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, (m) => (UUID.test(m) ? m : HIDDEN));
}

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function") return "[function]";
  if (typeof value !== "object") return String(value);
  if (value instanceof Error) return { name: value.name, message: scrubText(value.message).slice(0, MAX_STRING) };
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[deep]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = isSecretKey(k) ? HIDDEN : redact(v, depth + 1, seen);
  return out;
}

export type Level = "info" | "warn" | "error";

export function formatLog(level: Level, event: string, fields: Record<string, unknown> = {}, now: Date = new Date()): string {
  const safe = redact(fields) as Record<string, unknown>;
  return JSON.stringify({ ...safe, level, event, time: now.toISOString() });
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => console.log(formatLog("info", event, fields)),
  warn: (event: string, fields?: Record<string, unknown>) => console.warn(formatLog("warn", event, fields)),
  error: (event: string, fields?: Record<string, unknown>) => console.error(formatLog("error", event, fields)),
};
