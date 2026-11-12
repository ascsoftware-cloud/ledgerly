"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDeal, type DealFormState } from "../actions";

export function AddDealForm({
  slug,
  stages,
  contacts,
}: {
  slug: string;
  stages: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<DealFormState, FormData>(addDeal.bind(null, slug), { status: "idle" });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "saved") ref.current?.reset();
  }, [state]);

  const select = "h-12 w-full rounded-xl border bg-background px-3 text-base";
  return (
    <form ref={ref} action={action} aria-label="Add a deal" className="grid gap-3 rounded-2xl border bg-card p-4 shadow-card sm:grid-cols-[2fr_1fr_1.5fr_1.5fr_auto] sm:items-end">
      <label className="space-y-1 text-sm font-medium">
        Deal
        <Input name="title" required placeholder="Bathroom revamp" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Value (R)
        <Input name="value" inputMode="decimal" placeholder="4 500" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Client
        <select name="contactId" className={select} defaultValue="">
          <option value="">No client yet</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium">
        Stage
        <select name="stageId" className={select} defaultValue={stages[0]?.id}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="touch" disabled={pending}>
        {pending ? "Adding…" : "Add deal"}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-5">
          {state.message}
        </p>
      )}
    </form>
  );
}
