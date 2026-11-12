"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { addOpeningHours, addService, cancelBooking, removeOpeningHours, type ServiceFormResult, setBookingEnabled, setServiceActive } from "../actions";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message ?? "Couldn't do that. Try again.");
      if (ok) toast.success(ok);
      router.refresh();
    });
  return { pending, run };
}

export function BookingSwitch({ slug, enabled, link }: { slug: string; enabled: boolean; link: string }) {
  const [on, setOn] = useState(enabled);
  const { pending, run } = useRun();
  return (
    <section aria-label="Booking page" className="flex flex-wrap items-start gap-3 rounded-2xl border bg-card p-5 shadow-card">
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">Online booking page</h2>
        <p className="text-sm text-muted-foreground">
          {on ? (
            <>
              Clients book at <a href={link} className="break-all underline" target="_blank" rel="noreferrer">{link}</a>
            </>
          ) : (
            "Switch it on to let clients book a time themselves. Add services and opening hours below."
          )}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Take bookings online"
        disabled={pending}
        onClick={() => {
          const next = !on;
          setOn(next);
          run(async () => {
            const r = await setBookingEnabled(slug, next);
            if (!r.ok) setOn(!next);
            return r;
          }, next ? "Booking page is live" : "Booking page is off");
        }}
        className="relative mt-1 h-8 w-14 shrink-0 rounded-full bg-muted transition-colors duration-(--dur) aria-checked:bg-primary"
      >
        <span aria-hidden className={`absolute top-1 left-1 size-6 rounded-full bg-card shadow-card transition-transform duration-(--dur) ${on ? "translate-x-6" : ""}`} />
      </button>
    </section>
  );
}

export function ServiceList({ slug, services }: { slug: string; services: { id: string; name: string; duration_min: number; buffer_min: number; price_cents: number; active: boolean }[] }) {
  const { pending, run } = useRun();
  const router = useRouter();
  const [v, setV] = useState({ name: "", duration: "60", buffer: "0", price: "" });
  const [state, action, saving] = useActionState<ServiceFormResult, FormData>(async (prev, form) => {
    const r = await addService(slug, prev, form);
    if (r.status === "saved") {
      toast.success("Service added");
      setV({ name: "", duration: "60", buffer: "0", price: "" });
      router.refresh();
    }
    return r;
  }, { status: "idle" });
  return (
    <section aria-labelledby="services-heading" className="space-y-3">
      <h2 id="services-heading" className="font-semibold">
        Services
      </h2>
      {services.length > 0 && (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Services">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className={`min-w-0 flex-1 ${s.active ? "" : "text-muted-foreground line-through"}`}>
                {s.name} · {s.duration_min} min{s.buffer_min ? ` + ${s.buffer_min} min gap` : ""}
                {s.price_cents ? ` · ${formatMoney(s.price_cents)}` : ""}
              </span>
              <Button type="button" variant="ghost" size="touch" disabled={pending} onClick={() => run(() => setServiceActive(slug, s.id, !s.active))}>
                {s.active ? "Hide" : "Show"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form action={action} noValidate aria-label="Add a service" className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <label className="space-y-1 text-sm font-medium">
          Service
          <Input name="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Haircut" className="h-12 text-base" maxLength={80} />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Minutes
          <Input name="duration" value={v.duration} onChange={(e) => setV({ ...v, duration: e.target.value })} inputMode="numeric" className="h-12 text-base" />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Gap after
          <Input name="buffer" value={v.buffer} onChange={(e) => setV({ ...v, buffer: e.target.value })} inputMode="numeric" className="h-12 text-base" />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Price (R)
          <Input name="price" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} inputMode="decimal" placeholder="optional" className="h-12 text-base" />
        </label>
        <div className="flex items-end">
          <Button type="submit" size="touch" disabled={saving}>
            Add
          </Button>
        </div>
        {state.status === "error" && (
          <p role="alert" className="text-sm text-destructive sm:col-span-5">
            {state.message}
          </p>
        )}
      </form>
    </section>
  );
}

export function OpeningHours({ slug, rules }: { slug: string; rules: { id: string; weekday: number; start_time: string; end_time: string }[] }) {
  const { pending, run } = useRun();
  const [v, setV] = useState({ weekday: "1", start: "08:00", end: "17:00" });
  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";
  return (
    <section aria-labelledby="hours-heading" className="space-y-3">
      <h2 id="hours-heading" className="font-semibold">
        Opening hours <span className="font-normal text-muted-foreground">(South African time)</span>
      </h2>
      <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Opening hours">
        {WEEKDAYS.map((day, i) => {
          const mine = rules.filter((r) => r.weekday === i + 1);
          return (
            <li key={day} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="w-28 font-medium">{day}</span>
              {mine.length === 0 ? (
                <span className="text-sm text-muted-foreground">Closed</span>
              ) : (
                mine.map((r) => (
                  <span key={r.id} className="flex items-center gap-1 rounded-lg bg-muted pl-3 text-sm">
                    {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
                    <Button type="button" variant="ghost" size="icon-touch" aria-label={`Remove ${day} ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`} disabled={pending} onClick={() => run(() => removeOpeningHours(slug, r.id))}>
                      ×
                    </Button>
                  </span>
                ))
              )}
            </li>
          );
        })}
      </ul>
      <form
        aria-label="Add opening hours"
        className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[2fr_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addOpeningHours(slug, Number(v.weekday), v.start, v.end), "Hours added");
        }}
      >
        <label className="space-y-1 text-sm font-medium">
          Day
          <select value={v.weekday} onChange={(e) => setV({ ...v, weekday: e.target.value })} className={field}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Opens
          <Input type="time" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} className="h-12 text-base" />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Closes
          <Input type="time" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} className="h-12 text-base" />
        </label>
        <div className="flex items-end">
          <Button type="submit" size="touch" disabled={pending}>
            Add hours
          </Button>
        </div>
      </form>
    </section>
  );
}

export function CancelBooking({ slug, id, label }: { slug: string; id: string; label: string }) {
  const { pending, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Button type="button" variant="ghost" size="touch" aria-label={`Cancel ${label}`} onClick={() => setConfirming(true)}>
        Cancel
      </Button>
    );
  return (
    <span className="flex gap-1">
      <Button type="button" variant="destructive" size="touch" disabled={pending} onClick={() => run(() => cancelBooking(slug, id), "Booking cancelled")}>
        Yes, cancel it
      </Button>
      <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}
