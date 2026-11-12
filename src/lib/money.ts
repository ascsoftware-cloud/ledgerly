/**
 * Money helpers. All amounts are integer cents; nothing here returns a float.
 * Display format is South African: "R 1 234,56".
 */

export type LineInput = {
  quantity: number;
  unitCents: number;
  /** 0–100, up to two decimal places. */
  discountPct: number;
  vatRate: 0 | 15;
};

export type LineResult = { netCents: number; vatCents: number; grossCents: number };

export type Deposit = { type: "pct" | "amount"; value: number };

export type Totals = {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
};

const NBSP = " ";

/** Integer division rounding half away from zero. */
function divRound(numerator: bigint, denominator: bigint): number {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (abs * 2n + denominator) / (denominator * 2n);
  return Number(negative ? -rounded : rounded);
}

function stripGroups(digits: string, sep: "," | "."): string | null {
  const groups = digits.split(sep);
  const [head, ...rest] = groups;
  if (!head) return null;
  if (!rest.every((g) => g.length === 3)) return null;
  return groups.join("");
}

/**
 * Parses what a person types or a bank exports: "R 1 234,56", "1,234.56", "1.234,56", "12,5".
 * Returns cents, or null when the text is not clearly an amount. Never guesses:
 * a single dot followed by three digits ("12.345") is ambiguous and is rejected.
 */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/[\s  ]/g, "");
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (/^r/i.test(s)) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let whole: string | null;
  let frac = "";

  if (lastComma !== -1 && lastDot !== -1) {
    const dec = lastComma > lastDot ? "," : ".";
    const group = dec === "," ? "." : ",";
    const parts = s.split(dec);
    if (parts.length !== 2) return null;
    whole = stripGroups(parts[0] ?? "", group);
    frac = parts[1] ?? "";
    if (frac.includes(group)) return null;
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1] ?? "";
    if (parts.length === 2 && tail.length >= 1 && tail.length <= 2) {
      whole = parts[0] ?? "";
      frac = tail;
    } else if (parts.length === 2 && sep === ".") {
      return null; // "12.345": thousands or decimals? Refuse rather than guess.
    } else {
      whole = stripGroups(s, sep);
    }
  } else {
    whole = s;
  }

  if (whole === null || whole === "" || !/^\d+$/.test(whole)) return null;
  if (!/^\d{0,2}$/.test(frac)) return null;

  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Formats cents as "R 1 234,56". Deterministic on server and browser (no Intl). */
export function formatMoney(cents: number, currency: "ZAR" = "ZAR"): string {
  const symbol = currency === "ZAR" ? "R" : currency;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${symbol}${NBSP}${whole},${frac}`;
}

/**
 * One document line. The discount comes off first, VAT is charged on the discounted net,
 * and each figure is rounded half-up to a whole cent.
 */
export function calcLine(l: LineInput): LineResult {
  const qty = BigInt(Math.round(l.quantity * 10_000)); // 4 decimal places
  const keepBasisPoints = BigInt(10_000 - Math.round(l.discountPct * 100));
  const netCents = divRound(qty * BigInt(l.unitCents) * keepBasisPoints, 10_000n * 10_000n);
  const vatCents = divRound(BigInt(netCents) * BigInt(l.vatRate), 100n);
  return { netCents, vatCents, grossCents: netCents + vatCents };
}

/**
 * Document totals are sums of the rounded lines, never recomputed from the subtotal,
 * so the total always equals what the lines on the page add up to.
 */
export function calcTotals(lines: LineInput[], deposit?: Deposit): Totals {
  let subtotalCents = 0;
  let vatCents = 0;
  for (const line of lines) {
    const r = calcLine(line);
    subtotalCents += r.netCents;
    vatCents += r.vatCents;
  }
  const totalCents = subtotalCents + vatCents;

  let depositCents = 0;
  if (deposit && totalCents > 0) {
    depositCents =
      deposit.type === "pct"
        ? divRound(BigInt(totalCents) * BigInt(Math.round(deposit.value * 100)), 10_000n)
        : Math.round(deposit.value);
    depositCents = Math.min(Math.max(depositCents, 0), totalCents);
  }

  return { subtotalCents, vatCents, totalCents, depositCents, balanceCents: totalCents - depositCents };
}
