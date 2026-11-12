"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, todaySAST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { billHours, deleteEntry, logTime, type LogTimeResult, startTimer, stopTimer } from "../actions";
import { elapsedLabel, formatMinutes } from "../time";

type Entry = {
  id: string;
  mine: boolean;
  started_at: string;
  ended_at: string | null;
  minutes: number;
  description: string | null;
  billable: boolean;
  invoiceNumber: string | null;
  invoiced: boolean;
};

/** Start/stop timer. The start time lives in the database, so a reload (or another device) keeps it running. */
export function Timer({ slug, projectId, running }: { slug: string; projectId: string; running: { startedAt: string; here: boolean } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [what, setWhat] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [running]);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message ?? "Couldn't do that.");
      toast.success(ok);
      setWhat("");
      router.refresh();
    });

  if (running?.here) {
    return (
      <section aria-label="Timer" className="flex flex-wrap items-center gap-3 rounded-2xl bg-accent p-4">
        <span className="font-mono text-2xl font-semibold tabular-nums" role="timer" aria-live="off">
          {now ? elapsedLabel(running.startedAt, now) : "0:00:00"}
        </span>
        <Button type="button" size="touch" disabled={pending} onClick={() => run(() => stopTimer(slug, projectId), "Time saved")}>
          <Square className="size-5" aria-hidden /> Stop
        </Button>
      </section>
    );
  }
  return (
    <section aria-label="Timer" className="flex flex-wrap items-center gap-2 rounded-2xl bg-accent p-4">
      <Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What are you working on?" aria-label="What are you working on?" className="h-12 flex-1 text-base" maxLength={300} />
      <Button type="button" size="touch" disabled={pending} onClick={() => run(() => startTimer(slug, projectId, what), "Timer started")}>
        <Play className="size-5" aria-hidden /> Start timer
      </Button>
      {running && !running.here && <p className="basis-full text-sm text-muted-foreground">Starting here stops your timer on another project.</p>}
    </section>
  );
}

/** Type in time worked earlier. */
export function LogTime({ slug, projectId }: { slug: string; projectId: string }) {
  const router = useRouter();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [v, setV] = useState({ date: "", duration: "", description: "", billable: true });
  const [state, action, pending] = useActionState<LogTimeResult, FormData>(async (prev, form) => {
    const r = await logTime(slug, projectId, prev, form);
    if (r.status === "saved") {
      toast.success("Time logged");
      setV({ date: "", duration: "", description: "", billable: true });
      setRequestId(crypto.randomUUID());
      router.refresh();
    }
    return r;
  }, { status: "idle" });
  return (
    <form action={action} noValidate aria-label="Log time" className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[1fr_1fr_2fr_auto]">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="space-y-1 text-sm font-medium">
        Date <span className="font-normal text-muted-foreground">(blank = today)</span>
        <Input name="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} placeholder={todaySAST().split("-").reverse().join("/")} inputMode="numeric" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        How long
        <Input name="duration" value={v.duration} onChange={(e) => setV({ ...v, duration: e.target.value })} placeholder="1:30" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        What was done
        <Input name="description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className="h-12 text-base" maxLength={300} />
      </label>
      <div className="flex items-end gap-3">
        <label className="flex h-12 items-center gap-2 text-sm">
          <input type="checkbox" name="billable" checked={v.billable} onChange={(e) => setV({ ...v, billable: e.target.checked })} className="size-5 accent-primary" />
          Billable
        </label>
        <Button type="submit" size="touch" disabled={pending}>
          Log
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-4">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** The project's time; tick un-billed hours and turn them into a draft invoice in one tap.
 * Keyed by the un-billed entry ids on the page, so the selection resets when they change. */
export function TimeList({ slug, projectId, entries, rateCents, canBill }: { slug: string; projectId: string; entries: Entry[]; rateCents: number; canBill: boolean }) {
  const router = useRouter();
  const billable = entries.filter((e) => e.billable && !e.invoiced && e.ended_at);
  const [picked, setPicked] = useState<string[]>(() => billable.map((e) => e.id));
  const [pending, start] = useTransition();
  const minutes = billable.filter((e) => picked.includes(e.id)).reduce((s, e) => s + e.minutes, 0);
  const total = entries.filter((e) => e.ended_at).reduce((s, e) => s + e.minutes, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {formatMinutes(total)} logged · {formatMinutes(billable.reduce((s, e) => s + e.minutes, 0))} billable and not yet invoiced
      </p>
      <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Time entries">
        {entries.map((e) => {
          const can = canBill && e.billable && !e.invoiced && !!e.ended_at;
          return (
            <li key={e.id} className="flex min-h-14 items-center gap-3 px-4 py-2" aria-label={`${e.description ?? "Time"} ${formatMinutes(e.minutes)}`}>
              {can ? (
                <input
                  type="checkbox"
                  checked={picked.includes(e.id)}
                  onChange={(ev) => setPicked(ev.target.checked ? [...picked, e.id] : picked.filter((x) => x !== e.id))}
                  aria-label={`Bill ${e.description ?? "this time"}`}
                  className="size-5 accent-primary"
                />
              ) : (
                <span className="size-5" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{e.description ?? "Time"}</span>
                <span className="block text-sm text-muted-foreground">
                  {formatDate(e.started_at.slice(0, 10))}
                  {!e.ended_at ? " · running" : ""}
                  {!e.billable ? " · not billable" : ""}
                  {e.invoiced ? ` · on ${e.invoiceNumber ?? "a draft invoice"}` : ""}
                </span>
              </span>
              <span className="tabular-nums">{e.ended_at ? formatMinutes(e.minutes) : "…"}</span>
              {e.mine && !e.invoiced && e.ended_at && (
                <Button
                  type="button"
                  variant="ghost"
                  size="touch"
                  aria-label={`Remove ${e.description ?? "time"}`}
                  onClick={async () => {
                    const r = await deleteEntry(slug, projectId, e.id);
                    if (!r.ok) toast.error(r.message ?? "Couldn't remove it.");
                    else router.refresh();
                  }}
                >
                  Remove
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {canBill && billable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="touch"
            disabled={pending || picked.length === 0}
            onClick={() =>
              start(async () => {
                const r = await billHours(slug, projectId, picked);
                if (!r.ok) return void toast.error(r.message);
                toast.success("Draft invoice ready to check");
                router.push(`/${slug}/money/${r.invoiceId}`);
              })
            }
          >
            Bill {formatMinutes(minutes)}
          </Button>
          {rateCents > 0 ? (
            <span className="text-sm text-muted-foreground">
              about {formatMoney(Math.round((Math.round((minutes / 60) * 100) / 100) * rateCents))} before VAT
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Set an hourly rate below to bill time.</span>
          )}
        </div>
      )}
    </div>
  );
}
