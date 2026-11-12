"use client";

import { useActionState, useState } from "react";
import { Banknote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordPayment, type FormResult } from "../actions";
import { celebrate } from "./celebrate";

const rand = (cents: number) => (cents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Mark an invoice (part) paid by EFT, cash or card machine. */
export function RecordPayment({ slug, documentId, balanceCents }: { slug: string; documentId: string; balanceCents: number }) {
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [amount, setAmount] = useState(rand(balanceCents));
  const [method, setMethod] = useState("eft");
  const [paidOn, setPaidOn] = useState("");
  const [reference, setReference] = useState("");
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await recordPayment(slug, documentId, prev, form);
    if (r.status === "saved") {
      toast.success(r.first ? "Your first payment! 🎉" : r.message);
      if (r.first) void celebrate();
      setOpen(false);
    }
    return r;
  }, { status: "idle" });

  if (!open) {
    return (
      <Button
        variant="outline"
        size="touch"
        onClick={() => {
          setRequestId(crypto.randomUUID());
          setAmount(rand(balanceCents));
          setOpen(true);
        }}
      >
        <Banknote className="size-5" aria-hidden /> Record a payment
      </Button>
    );
  }

  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";
  return (
    <form action={action} noValidate aria-label="Record a payment" className="grid w-full gap-3 rounded-2xl border bg-card p-4 shadow-card sm:grid-cols-2">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="space-y-1 text-sm font-medium">
        Amount (R)
        <Input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        How it was paid
        <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
          <option value="eft">EFT</option>
          <option value="cash">Cash</option>
          <option value="card">Card machine</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium">
        Date <span className="font-normal text-muted-foreground">(blank = today)</span>
        <Input name="paidOn" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} placeholder="31/01/2027" inputMode="numeric" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Reference <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="reference" value={reference} onChange={(e) => setReference(e.target.value)} className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Proof of payment <span className="font-normal text-muted-foreground">(optional photo or PDF, up to 5 MB)</span>
        <input name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="block w-full text-sm" />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Saving…" : "Save payment"}
        </Button>
        <Button type="button" variant="ghost" size="touch" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
