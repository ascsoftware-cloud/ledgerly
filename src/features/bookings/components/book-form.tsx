"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bookSlot, type BookState } from "../public-actions";

/** The visitor's details. Nothing is stored until they press Book. */
export function BookForm({ slug, serviceId, startsAt }: { slug: string; serviceId: string; startsAt: string }) {
  const [v, setV] = useState({ name: "", email: "", phone: "", notes: "" });
  const [state, action, pending] = useActionState<BookState, FormData>((prev, form) => bookSlot(slug, prev, form), { status: "idle" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form action={action} noValidate aria-label="Book" className="grid gap-4 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <label className="space-y-1 text-sm font-medium">
        Your name
        <Input name="name" value={v.name} onChange={set("name")} autoComplete="name" className="h-12 text-base" maxLength={120} />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Email <span className="font-normal text-muted-foreground">(for your confirmation)</span>
        <Input name="email" type="email" value={v.email} onChange={set("email")} autoComplete="email" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Phone <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="phone" type="tel" value={v.phone} onChange={set("phone")} autoComplete="tel" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Anything they should know? <span className="font-normal text-muted-foreground">(optional)</span>
        <textarea name="notes" value={v.notes} onChange={set("notes")} rows={2} maxLength={500} className="w-full rounded-xl border bg-background p-3 text-base" />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground sm:col-span-2">Your details go only to this business, to manage your booking.</p>
      <Button type="submit" size="touch" disabled={pending} className="sm:col-span-2">
        {pending ? "Booking…" : "Book"}
      </Button>
    </form>
  );
}
