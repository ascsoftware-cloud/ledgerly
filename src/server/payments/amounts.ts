/** PayFast wants rand with two decimals and a dot: 123456 cents → "1234.56". */
export function centsToPayfastAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "1234.56" → 123456, or null when it is not a plain amount. */
export function payfastAmountToCents(s: string | null): number | null {
  if (!s || !/^-?\d+(\.\d{1,2})?$/.test(s.trim())) return null;
  const [whole, frac = ""] = s.trim().replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return s.trim().startsWith("-") ? -cents : cents;
}
