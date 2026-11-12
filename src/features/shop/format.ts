import { formatMoney } from "@/lib/money";

/** Shop amounts are in the store's currency, usually ZAR. */
export function formatShopMoney(amount: number, currency: string): string {
  if (currency === "ZAR") return formatMoney(Math.round(amount * 100));
  try {
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Shopify's display statuses ("PARTIALLY_PAID") as words. */
export function statusWords(s: string | null): string {
  if (!s) return "—";
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Sales per day (SAST) for the last `days` days, cancelled orders left out. */
export function salesByDay(
  orders: { shop_created_at: string; cancelled_at: string | null; total: number }[],
  days: number,
  now: Date = new Date(),
): { day: string; total: number; count: number }[] {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const out = new Map<string, { total: number; count: number }>();
  for (let i = days - 1; i >= 0; i--)
    out.set(fmt.format(new Date(now.getTime() - i * 86_400_000)), { total: 0, count: 0 });
  for (const o of orders) {
    if (o.cancelled_at) continue;
    const day = fmt.format(new Date(o.shop_created_at));
    const slot = out.get(day);
    if (!slot) continue;
    slot.total = Math.round((slot.total + o.total) * 100) / 100;
    slot.count += 1;
  }
  return [...out.entries()].map(([day, v]) => ({ day, ...v }));
}
