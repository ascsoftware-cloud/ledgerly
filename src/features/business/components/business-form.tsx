"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveBusiness, type BusinessResult } from "../actions";

export type BusinessInitial = { name: string; registration: string; vatRegistered: boolean; vatNumber: string };

export function BusinessForm({ slug, initial }: { slug: string; initial: BusinessInitial }) {
  const router = useRouter();
  // Controlled, so a mistake does not wipe what was typed (a form action resets plain inputs when it finishes).
  const [name, setName] = useState(initial.name);
  const [registration, setRegistration] = useState(initial.registration);
  const [vat, setVat] = useState(initial.vatRegistered);
  const [vatNumber, setVatNumber] = useState(initial.vatNumber);
  const [state, action, pending] = useActionState<BusinessResult, FormData>(async (prev, form) => {
    const r = await saveBusiness(slug, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      router.refresh();
    }
    return r;
  }, { status: "idle" });
  const error = (field: string) => (state.status === "error" && state.field === field ? state.message : null);

  return (
    <form action={action} noValidate aria-label="Business details" className="grid gap-4 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Business name
        <Input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={!!error("name")} className="h-12 text-base" />
        <span className="block text-xs font-normal text-muted-foreground">Shown in the app and on your invoices and quotes.</span>
        {error("name") && (
          <span role="alert" className="block text-sm text-destructive">
            {error("name")}
          </span>
        )}
      </label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Company registration number <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="registration" value={registration} onChange={(e) => setRegistration(e.target.value)} maxLength={40} placeholder="2020/123456/07" className="h-12 text-base" />
        {error("registration") && (
          <span role="alert" className="block text-sm text-destructive">
            {error("registration")}
          </span>
        )}
      </label>
      <label className="flex items-center gap-3 text-sm font-medium sm:col-span-2">
        <input type="checkbox" name="vatRegistered" checked={vat} onChange={(e) => setVat(e.target.checked)} className="size-5 accent-primary" />
        We are registered for VAT
      </label>
      {vat && (
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          VAT number
          <Input name="vatNumber" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} inputMode="numeric" placeholder="4123456789" aria-invalid={!!error("vatNumber")} className="h-12 text-base" />
          {error("vatNumber") && (
            <span role="alert" className="block text-sm text-destructive">
              {error("vatNumber")}
            </span>
          )}
        </label>
      )}
      {state.status === "error" && !state.field && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
