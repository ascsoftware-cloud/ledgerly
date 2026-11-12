"use client";

import { useActionState, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptQuote, type AcceptState } from "../public-actions";

/** Accepting a quote: type your name, tick the box. An ordinary electronic signature (ECT Act). */
export function AcceptQuote({ token, business }: { token: string; business: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptQuote.bind(null, token), { status: "idle" });
  // Controlled, because React clears a form's fields after each submit, errors included.
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);

  if (state.status === "accepted") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success/10 p-5">
        <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden />
        <p>
          Thanks, {state.name}. {business} has been told you accepted.
        </p>
      </div>
    );
  }

  return (
    <form action={action} noValidate aria-label="Accept this quote" className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
      <h2 className="text-lg font-semibold">Happy with this quote?</h2>
      <div className="space-y-1.5">
        <label htmlFor="signer" className="text-sm font-medium">
          Your full name
        </label>
        <Input id="signer" name="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className="h-12 text-base" />
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 size-5 accent-(--accent-c)" />
        <span>
          I accept this quote. Typing my name counts as my signature, and the date, time and my device are recorded.
        </span>
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <Button type="submit" size="touch" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "Saving…" : "Accept quote"}
      </Button>
    </form>
  );
}
