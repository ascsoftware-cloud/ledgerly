import { z } from "zod";
import { formatDate } from "@/lib/dates";

export const KINDS = ["payment", "invoice_viewed", "quote_accepted", "booking", "low_stock", "task_assigned", "automation", "daily"] as const;
export type Kind = (typeof KINDS)[number];

const LABELS: Record<Kind, { label: string; help: string }> = {
  payment: { label: "Payment received", help: "When a client pays an invoice." },
  invoice_viewed: { label: "Invoice opened", help: "The first time a client opens an invoice or quote you sent." },
  quote_accepted: { label: "Quote accepted", help: "When a client accepts a quote." },
  booking: { label: "New booking", help: "When someone books through your booking page." },
  low_stock: { label: "Low stock", help: "When a product falls to its re-order level." },
  task_assigned: { label: "Task given to you", help: "When someone gives you a task." },
  automation: { label: "Automation alerts", help: "Alerts from your own automation rules." },
  daily: { label: "Daily reminder", help: "A short summary at 08:00 of overdue invoices and tasks due." },
};
export const kindLabel = (k: Kind) => LABELS[k].label;
export const kindHelp = (k: Kind) => LABELS[k].help;

/** The current time in ms, behind a function so pages can ask for it. */
export const nowMs = () => Date.now();

/** "just now", "5 min ago", "2 h ago", "yesterday", then the date. A clock slightly ahead counts as "just now". */
export function timeAgo(iso: string, nowMs: number): string {
  const diff = nowMs - Date.parse(iso);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 172_800_000) return "yesterday";
  // Dates are shown in South African time.
  return formatDate(new Date(Date.parse(iso) + 2 * 3_600_000).toISOString().slice(0, 10));
}

const bool = z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]);
export const prefsSchema = z.object({ kind: z.enum(KINDS), enabled: bool, push: bool });

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(600).regex(/^https:\/\//, "Push needs a secure address."),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
