"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendToAccounting } from "../actions";

type Status = {
  connectionId: string;
  provider: "xero" | "sage_za";
  name: string | null;
  state: "synced" | "mismatch" | "failed" | "waiting" | "not_sent";
  number: string | null;
  error: string | null;
};

const APP = { xero: "Xero", sage_za: "Sage" } as const;

/** Where this invoice or credit note stands in each connected accounting app. */
export function AccountingStatus({
  slug,
  documentId,
  statuses,
  canSend,
}: {
  slug: string;
  documentId: string;
  statuses: Status[];
  canSend: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!statuses.length) return null;
  return (
    <ul className="flex flex-wrap gap-2 text-sm" aria-label="Accounting apps">
      {statuses.map((s) => (
        <li
          key={s.connectionId}
          className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2"
        >
          {s.state === "synced" && <CheckCircle2 className="size-4 text-success" aria-hidden />}
          {(s.state === "mismatch" || s.state === "failed") && (
            <AlertTriangle className="size-4 text-destructive" aria-hidden />
          )}
          {s.state === "waiting" && <Clock className="size-4 text-muted-foreground" aria-hidden />}
          <span>
            {s.state === "synced" && `In ${APP[s.provider]}${s.number ? ` as ${s.number}` : ""}`}
            {s.state === "mismatch" &&
              `In ${APP[s.provider]}, but its total differs from Ledgerly's. Check the VAT rounding there.`}
            {s.state === "waiting" && `Sending to ${APP[s.provider]}…`}
            {s.state === "failed" && `Not in ${APP[s.provider]}: ${s.error ?? "it failed"}`}
            {s.state === "not_sent" && `Not sent to ${APP[s.provider]}`}
          </span>
          {canSend && (s.state === "not_sent" || s.state === "failed") && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await sendToAccounting(slug, documentId);
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.message);
                  router.refresh();
                })
              }
            >
              <Send className="size-3.5" aria-hidden /> Send now
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
