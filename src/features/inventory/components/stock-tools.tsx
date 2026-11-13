"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adjustStock, setProductArchived, setSupplierArchived, type FormResult } from "../actions";

/** Add or remove stock by hand (a count, breakage, a return). Every change is kept in the history. */
export function AdjustStock({ slug, productId }: { slug: string; productId: string }) {
  const router = useRouter();
  const [change, setChange] = useState("");
  const [note, setNote] = useState("");
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await adjustStock(slug, productId, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      setChange("");
      setNote("");
      router.refresh();
    }
    return r;
  }, { status: "idle" });

  return (
    <form action={action} noValidate aria-label="Change stock" className="grid gap-3 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <label className="space-y-1 text-sm font-medium">
        Add or remove
        <Input name="change" inputMode="decimal" value={change} onChange={(e) => setChange(e.target.value)} placeholder="5 or -3" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Why <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Stock count, breakage, return…" maxLength={200} className="h-12 text-base" />
      </label>
      <Button type="submit" size="touch" disabled={pending}>
        {pending ? "Saving…" : "Update stock"}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** Archive a product or supplier after a confirm step; it can be restored from the archived list. */
export function ArchiveButton({ slug, id, what, name }: { slug: string; id: string; what: "product" | "supplier"; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  if (!confirming)
    return (
      <Button type="button" variant="outline" size="touch" onClick={() => setConfirming(true)}>
        Archive
      </Button>
    );
  return (
    <span className="flex flex-wrap gap-1" role="group" aria-label={`Archive ${name}?`}>
      <Button
        type="button"
        variant="destructive"
        size="touch"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await (what === "product" ? setProductArchived(slug, id, true) : setSupplierArchived(slug, id, true));
            setConfirming(false);
            if (!r.ok) return void toast.error("Couldn't archive that.");
            toast.success(`${name} archived`);
            router.push(`/${slug}/stock${what === "supplier" ? "/suppliers" : ""}`);
          })
        }
      >
        Yes, archive {name}
      </Button>
      <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}

export function RestoreButton({ slug, id, what, name }: { slug: string; id: string; what: "product" | "supplier"; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      disabled={pending}
      aria-label={`Restore ${name}`}
      onClick={() =>
        start(async () => {
          const r = await (what === "product" ? setProductArchived(slug, id, false) : setSupplierArchived(slug, id, false));
          if (!r.ok) return void toast.error("Couldn't restore that.");
          toast.success(`${name} restored`);
          router.refresh();
        })
      }
    >
      Restore
    </Button>
  );
}
