import { STATUS_LABEL, type ShownStatus } from "../status";

const TONE: Record<ShownStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-accent text-foreground",
  viewed: "bg-accent text-foreground",
  accepted: "bg-success/15 text-success",
  declined: "bg-muted text-muted-foreground",
  part_paid: "bg-warning/15 text-warning",
  paid: "bg-success/15 text-success",
  void: "bg-muted text-muted-foreground line-through",
  overdue: "bg-destructive/15 text-destructive",
};

export function StatusBadge({ status }: { status: ShownStatus }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold ${TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
