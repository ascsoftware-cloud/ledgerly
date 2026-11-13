"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveSupplier, type FormResult } from "../actions";

type Initial = { name: string; email: string; phone: string; notes: string };

export function SupplierForm({ slug, supplierId = null, initial }: { slug: string; supplierId?: string | null; initial?: Initial }) {
  const router = useRouter();
  const [v, setV] = useState<Initial>(initial ?? { name: "", email: "", phone: "", notes: "" });
  const set = (k: keyof Initial) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await saveSupplier(slug, supplierId, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      router.push(`/${slug}/stock/suppliers`);
    }
    return r;
  }, { status: "idle" });

  return (
    <form action={action} noValidate aria-label={supplierId ? "Edit supplier" : "Add a supplier"} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Supplier name
        <Input name="name" value={v.name} onChange={set("name")} className="h-12 text-base" autoFocus={!supplierId} />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Email <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="email" type="email" inputMode="email" value={v.email} onChange={set("email")} className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Phone <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="phone" type="tel" inputMode="tel" value={v.phone} onChange={set("phone")} className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Notes <span className="font-normal text-muted-foreground">(optional)</span>
        <textarea name="notes" value={v.notes} onChange={set("notes")} rows={3} maxLength={1000} className="w-full rounded-xl border bg-background p-3 text-base" />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Saving…" : supplierId ? "Save changes" : "Add supplier"}
        </Button>
        <Button type="button" variant="ghost" size="touch" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
