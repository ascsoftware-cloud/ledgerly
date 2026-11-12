import { parseDateZA } from "@/lib/dates";
import { parseAmount } from "@/lib/money";

/**
 * Bank statement CSVs. South African banks do not publish their export formats and they
 * vary by account type, so nothing here assumes a particular bank: the header row is found,
 * columns are guessed, and the owner confirms the mapping before anything is imported.
 */

export type BankMapping = {
  date: number | null;
  /** One signed amount column (money in positive), or separate debit and credit columns. */
  amount: number | null;
  debit: number | null;
  credit: number | null;
  /** Joined with spaces, e.g. description + reference. */
  description: number[];
};

export type BankLine = { postedOn: string; amountCents: number; description: string };
export type Skipped = { row: number; reason: "summary" | "no date" | "no amount" };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseBankDate(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf((m[2] ?? "").slice(0, 3).toLowerCase());
    return month < 0 ? null : iso(Number(m[3]), month + 1, Number(m[1]));
  }
  if (!/^\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s)) return null;
  return parseDateZA(s);
}

/** Signed cents. "450.00 Dr", "(450.00)" and "-450" are money out; "Cr" or no sign is money in. */
export function parseBankAmount(input: string): number | null {
  let s = (input ?? "").trim();
  if (!s) return null;
  let sign = 1;
  const suffix = /\s*(dr|cr)$/i.exec(s);
  if (suffix) {
    if (suffix[1]?.toLowerCase() === "dr") sign = -1;
    s = s.slice(0, suffix.index).trim();
  }
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    sign = -1;
    s = paren[1] ?? "";
  }
  const cents = parseAmount(s);
  if (cents === null) return null;
  return sign * cents;
}

const has = (h: string, re: RegExp) => re.test(h.trim());
const DATE = /date|datum/i;
const BALANCE = /balance|saldo/i;
const DEBIT = /debit|withdraw|money out|paid out/i;
const CREDIT = /credit|deposit|money in|paid in/i;
const AMOUNT = /amount|value|bedrag/i;
const TEXT = /desc|detail|narrative|reference|particular|transaction|memo|payee|beskrywing/i;

export function guessBankMapping(headers: string[]): BankMapping {
  const taken = new Set<number>();
  const pick = (test: (h: string) => boolean): number | null => {
    const i = headers.findIndex((h, idx) => !taken.has(idx) && test(h ?? ""));
    if (i < 0) return null;
    taken.add(i);
    return i;
  };
  const date = pick((h) => has(h, DATE));
  headers.forEach((h, i) => has(h ?? "", BALANCE) && taken.add(i));
  let debit = pick((h) => has(h, DEBIT));
  let credit = pick((h) => has(h, CREDIT));
  let amount: number | null = null;
  if (debit === null || credit === null) {
    for (const i of [debit, credit]) if (i !== null) taken.delete(i);
    debit = credit = null;
    amount = pick((h) => has(h, AMOUNT));
  }
  const description = headers.flatMap((h, i) => (!taken.has(i) && has(h ?? "", TEXT) ? [i] : []));
  return { date, amount, debit, credit, description };
}

const usable = (m: BankMapping) => m.date !== null && (m.amount !== null || (m.debit !== null && m.credit !== null));

/** Finds the header row past any preamble, or guesses columns from the data when there is none. */
export function findTable(rows: string[][]): { headers: string[]; firstDataRow: number; mapping: BankMapping } {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] ?? [];
    if (row.filter((c) => c?.trim()).length < 2) continue;
    const mapping = guessBankMapping(row);
    if (usable(mapping)) return { headers: row.map((c) => c.trim()), firstDataRow: i + 1, mapping };
  }

  const start = rows.findIndex((r) => r.some((c) => parseBankDate(c) !== null) && r.some((c) => parseBankDate(c) === null && parseBankAmount(c) !== null));
  const first = start < 0 ? 0 : start;
  const sample = rows.slice(first, first + 20).filter((r) => r.some((c) => c?.trim()));
  const width = Math.max(0, ...sample.map((r) => r.length));
  const share = (col: number, ok: (c: string) => boolean) =>
    sample.length ? sample.filter((r) => ok(r[col] ?? "")).length / sample.length : 0;
  const cols = Array.from({ length: width }, (_, i) => i);
  const date = cols.find((c) => share(c, (v) => parseBankDate(v) !== null) >= 0.6) ?? null;
  const numeric = cols.filter((c) => c !== date && share(c, (v) => parseBankAmount(v) !== null) >= 0.6);
  const text = cols.filter((c) => c !== date && !numeric.includes(c) && share(c, (v) => v.trim() !== "") >= 0.6);
  return {
    headers: cols.map((c) => `Column ${c + 1}`),
    firstDataRow: first,
    mapping: { date, amount: numeric[0] ?? null, debit: null, credit: null, description: text.slice(0, 1) },
  };
}

const SUMMARY = /brought\s*forward|carried\s*forward|opening\s*balance|closing\s*balance|balance\s*[bc]\/f/i;

/** Rows → transactions. `startRow` is the 0-based index of rows[0] in the file, for error messages. */
export function toBankLines(rows: string[][], m: BankMapping, startRow: number): { lines: BankLine[]; skipped: Skipped[] } {
  const lines: BankLine[] = [];
  const skipped: Skipped[] = [];
  rows.forEach((r, i) => {
    if (!r.some((c) => c?.trim())) return;
    const row = startRow + i + 1;
    const description = m.description
      .map((c) => (r[c] ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 300);
    if (SUMMARY.test(description) || r.some((c) => SUMMARY.test(c ?? ""))) return skipped.push({ row, reason: "summary" });
    const postedOn = m.date === null ? null : parseBankDate(r[m.date] ?? "");
    if (!postedOn) return skipped.push({ row, reason: "no date" });
    let amountCents: number | null;
    if (m.amount !== null) amountCents = parseBankAmount(r[m.amount] ?? "");
    else {
      const c = m.credit === null ? null : parseBankAmount(r[m.credit] ?? "");
      const d = m.debit === null ? null : parseBankAmount(r[m.debit] ?? "");
      amountCents = c === null && d === null ? null : Math.abs(c ?? 0) - Math.abs(d ?? 0);
    }
    if (!amountCents) return skipped.push({ row, reason: "no amount" });
    lines.push({ postedOn, amountCents, description });
  });
  return { lines, skipped };
}

/**
 * Stable identity for each line: date, amount, normalised description, and how many identical
 * lines came before it in the same file. Re-importing a file gives the same keys.
 */
export function fingerprintKeys(lines: BankLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = `${l.postedOn}|${l.amountCents}|${l.description.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

export function detectDuplicates(keys: string[], existing: Set<string>): { fresh: number[]; duplicates: number[] } {
  const fresh: number[] = [];
  const duplicates: number[] = [];
  keys.forEach((k, i) => (existing.has(k) ? duplicates : fresh).push(i));
  return { fresh, duplicates };
}

export type OpenInvoice = { id: string; number: string; owedCents: number };

/** A likely invoice for money in: its number in the description, else a unique exact amount. */
export function suggestMatch(
  line: { amountCents: number; description: string },
  invoices: OpenInvoice[],
): { id: string; reason: "number" | "amount" } | null {
  if (line.amountCents <= 0) return null;
  const tokens = line.description.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const candidates = new Set([...tokens, ...tokens.slice(1).map((t, i) => tokens[i] + t)]);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byNumber = invoices.find((inv) => candidates.has(norm(inv.number)) && line.amountCents <= inv.owedCents);
  if (byNumber) return { id: byNumber.id, reason: "number" };
  const byAmount = invoices.filter((inv) => inv.owedCents === line.amountCents);
  return byAmount.length === 1 && byAmount[0] ? { id: byAmount[0].id, reason: "amount" } : null;
}
