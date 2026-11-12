import { isOverdue } from "@/lib/dates";

export type StoredStatus = "draft" | "sent" | "viewed" | "accepted" | "declined" | "part_paid" | "paid" | "void";
export type ShownStatus = StoredStatus | "overdue";

/** "Overdue" is not stored: it is a sent invoice whose due date has passed (in SAST). */
export function effectiveStatus(d: { status: StoredStatus; dueDate: string | null }, now: Date = new Date()): ShownStatus {
  if ((d.status === "sent" || d.status === "viewed" || d.status === "part_paid") && d.dueDate && isOverdue(d.dueDate, now)) {
    return "overdue";
  }
  return d.status;
}

export const STATUS_LABEL: Record<ShownStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
  part_paid: "Part paid",
  paid: "Paid",
  void: "Void",
  overdue: "Overdue",
};

export function balanceCents(d: { totalCents: number; paidCents: number; creditedCents: number }): number {
  return Math.max(0, d.totalCents - d.paidCents - d.creditedCents);
}

/** Turns a database refusal into words for the person sending. Unknown errors stay vague. */
export function sendErrorMessage(err: { code?: string; message?: string } | null): string {
  if (err?.code === "LDG01") {
    return "You've sent 10 invoices and quotes this month, the Free plan limit. It resets on the 1st, or upgrade to Pro for unlimited.";
  }
  if ((err?.code === "LDG02" || err?.code === "LDG03") && err.message) return err.message;
  return "Couldn't send it. Try again in a moment.";
}
