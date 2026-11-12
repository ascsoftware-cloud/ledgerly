"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removePayment } from "../actions";

/** Two-step remove for a mistaken manual payment: "Remove", then "Yes, remove it". */
export function RemovePayment({ slug, documentId, paymentId, label }: { slug: string; documentId: string; paymentId: string; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="touch" aria-label={`Remove payment ${label}`} onClick={() => setConfirming(true)}>
        Remove
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button
        type="button"
        variant="destructive"
        size="touch"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await removePayment(slug, documentId, paymentId);
            if (r.ok) toast.success("Payment removed");
            else {
              toast.error(r.message ?? "Couldn't remove that payment.");
              setConfirming(false);
            }
          })
        }
      >
        Yes, remove it
      </Button>
      <Button type="button" variant="ghost" size="touch" disabled={pending} onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}
