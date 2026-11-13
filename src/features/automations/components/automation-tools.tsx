"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRule, deleteRule, setRuleEnabled, type FormResult } from "../actions";
import { ACTIONS, actionsFor, TRIGGER_KEYS, TRIGGERS, unitFor, type Trigger } from "../schema";

export function RuleForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("invoice_overdue");
  const [threshold, setThreshold] = useState("3");
  const [action, setAction] = useState<string>("notify_me");
  const unit = unitFor(trigger);
  const actions = actionsFor(trigger);

  const [state, formAction, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await createRule(slug, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      setName("");
      router.refresh();
    }
    return r;
  }, { status: "idle" });
  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";

  return (
    <form action={formAction} noValidate aria-label="New automation" className="grid gap-4 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Name
        <Input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Chase late invoices" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        When
        <select
          name="trigger"
          value={trigger}
          onChange={(e) => {
            const t = e.target.value as Trigger;
            setTrigger(t);
            setThreshold(unitFor(t) === "hours" ? "24" : "3");
            if (!actionsFor(t).includes(action as never)) setAction("notify_me");
          }}
          className={field}
        >
          {TRIGGER_KEYS.map((t) => (
            <option key={t} value={t}>
              {TRIGGERS[t].label}
            </option>
          ))}
        </select>
      </label>
      {unit && (
        <label className="space-y-1 text-sm font-medium">
          For how many {unit}?
          <Input name="threshold" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-12 text-base" />
        </label>
      )}
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Then
        <select name="action" value={action} onChange={(e) => setAction(e.target.value)} className={field}>
          {actions.map((a) => (
            <option key={a} value={a}>
              {ACTIONS[a]}
            </option>
          ))}
        </select>
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Saving…" : "Add rule"}
        </Button>
      </div>
    </form>
  );
}

export function RuleControls({ slug, id, name, enabled: initial }: { slug: string; id: string; name: string; enabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setEnabled(next);
            start(async () => {
              const r = await setRuleEnabled(slug, id, next);
              if (!r.ok) {
                setEnabled(!next);
                return void toast.error("Couldn't change that.");
              }
              router.refresh();
            });
          }}
          className="size-5 accent-primary"
        />
        On<span className="sr-only">: {name}</span>
      </label>
      {confirming ? (
        <span className="flex gap-1" role="group" aria-label={`Delete ${name}?`}>
          <Button
            type="button"
            variant="destructive"
            size="touch"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteRule(slug, id);
                setConfirming(false);
                if (!r.ok) return void toast.error("Couldn't delete that.");
                toast.success("Rule deleted");
                router.refresh();
              })
            }
          >
            Yes, delete
          </Button>
          <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <Button type="button" variant="ghost" size="touch" aria-label={`Delete ${name}`} onClick={() => setConfirming(true)}>
          Delete
        </Button>
      )}
    </span>
  );
}
