/**
 * Date helpers. Calendar dates are "YYYY-MM-DD" strings. "Today" always means
 * today in South Africa (SAST, UTC+2, no daylight saving), wherever the code runs.
 */

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function todaySAST(now: Date = new Date()): string {
  return new Date(now.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

/** An invoice is overdue from midnight SAST after its due date. */
export function isOverdue(dueDate: string, now: Date = new Date()): boolean {
  return todaySAST(now) > dueDate;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null; // e.g. 31 April, 29 Feb in a non-leap year
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Parses dates the way South Africans write them: day first ("31/01/2026", "31-01-26",
 * "5.3.2026"), plus ISO ("2026-01-31"). Month-first dates are rejected, not reinterpreted.
 */
export function parseDateZA(input: string): string | null {
  const s = input.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (dmy) {
    const yearText = dmy[3] ?? "";
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    return toIso(year, Number(dmy[2]), Number(dmy[1]));
  }
  return null;
}

/** "2026-01-31" → "31 Jan 2026". Deterministic on server and browser (no Intl). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
