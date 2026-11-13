import { parseDateZA, todaySAST } from "../dates";
import { parseAmount } from "../money";

export type ReceiptResult =
  | { ok: true; amountCents: number; vatCents: number; supplier: string | null; date: string | null }
  | { ok: false; reason: string };

const MAX_CENTS = 100_000_000; // R1 000 000: beyond this a misread is likelier than a real till slip

function cents(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? parseAmount(String(v)) : null;
  if (typeof v === "string") return parseAmount(v);
  return null;
}

/**
 * Turns the vision model's text into checked numbers. The model's answer is untrusted: only a clean positive
 * total gets through, and the person still reviews every field before saving.
 */
export function parseReceipt(raw: string, now: Date = new Date()): ReceiptResult {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, reason: "no data" };
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "not an object" };
  const o = data as Record<string, unknown>;

  const total = cents(o.total);
  if (total === null || total <= 0 || total > MAX_CENTS) return { ok: false, reason: "no usable total" };

  const vat = cents(o.vat);
  const vatCents = vat !== null && vat > 0 && vat < total ? vat : 0;

  const supplier = typeof o.supplier === "string" ? o.supplier.replace(/\s+/g, " ").trim().slice(0, 120) : "";

  let date: string | null = null;
  if (typeof o.date === "string") {
    const d = parseDateZA(o.date);
    if (d && d <= todaySAST(now) && d >= "2000-01-01") date = d;
  }
  return { ok: true, amountCents: total, vatCents, supplier: supplier || null, date };
}
