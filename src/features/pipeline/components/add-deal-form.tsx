"use client";

import { useActionState, useState } from "react";
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
  // Controlled, because React clears a form's fields after each submit, errors included.
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [state, action, pending] = useActionState<DealFormState, FormData>(async (prev, form) => {
    const result = await addDeal(slug, prev, form);
    if (result.status === "saved") {
      setTitle("");
      setValue("");
    }
    return result;
  }, { status: "idle" });

  const select = "h-12 w-full rounded-xl border bg-background px-3 text-base";
  return (
    <form action={action} aria-label="Add a deal" className="grid gap-3 rounded-2xl border bg-card p-4 shadow-card sm:grid-cols-[2fr_1fr_1.5fr_1.5fr_auto] sm:items-end">
      <label className="space-y-1 text-sm font-medium">
        Deal
        <Input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bathroom revamp" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Value (R)
        <Input name="value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="4 500" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Client
        <select name="contactId" className={select} value={contactId} onChange={(e) => setContactId(e.target.value)}>
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
        <select name="stageId" className={select} value={stageId} onChange={(e) => setStageId(e.target.value)}>
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
