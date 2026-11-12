"use client";

import { useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { setAutoReminders } from "../actions";

/** Off until the business switches it on: Ledgerly never emails clients unasked. */
export function RemindersSwitch({ slug, initial }: { slug: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  return (
    <section aria-label="Payment reminders" className="flex items-start gap-3 rounded-2xl border bg-card p-5 shadow-card">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
        <BellRing className="size-5" aria-hidden />
      </span>
      <div className="flex-1">
        <h2 className="font-semibold">Payment reminders</h2>
        <p className="text-sm text-muted-foreground">
          Email clients a polite reminder 3 days before an invoice is due, on the day, and 3 days after. Paid invoices are skipped.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Send payment reminders automatically"
        disabled={pending}
        onClick={() => {
          const next = !on;
          setOn(next);
          start(async () => {
            const r = await setAutoReminders(slug, next);
            if (!r.ok) {
              setOn(!next);
              toast.error("Couldn't change that. Try again.");
            } else toast.success(next ? "Reminders are on" : "Reminders are off");
          });
        }}
        className="relative mt-1 h-8 w-14 shrink-0 rounded-full bg-muted transition-colors duration-(--dur) aria-checked:bg-primary"
      >
        <span
          aria-hidden
          className={`absolute top-1 left-1 size-6 rounded-full bg-card shadow-card transition-transform duration-(--dur) ${on ? "translate-x-6" : ""}`}
        />
      </button>
    </section>
  );
}
