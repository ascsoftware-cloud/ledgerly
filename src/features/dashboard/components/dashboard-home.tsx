import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Flame, PartyPopper, ShieldCheck, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { QUEST, QUEST_XP, questHref } from "@/features/quest/catalogue";
import { formatMoney } from "@/lib/money";
import type { WorkspaceContext } from "@/lib/workspace";
import { greeting } from "../greeting";
import type { DashboardData } from "../queries";

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`rounded-2xl border bg-card p-5 shadow-card ${className}`}>
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function GoalRing({ fraction }: { fraction: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 80 80" className="size-20 -rotate-90" aria-hidden>
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-muted" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(Math.max(fraction, 0), 1))}
        className="stroke-primary transition-[stroke-dashoffset] duration-(--dur-slow)"
      />
    </svg>
  );
}

export function DashboardHome({ ctx, data }: { ctx: WorkspaceContext; data: DashboardData }) {
  const slug = ctx.workspace.slug;
  const done = data.quest.filter((q) => q.done).length;
  const total = data.quest.length;
  const paidThisMonth = 0; // Filled in once invoices exist (Phase 3).

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting()}
          {ctx.user.firstName ? `, ${ctx.user.firstName}` : ""}
        </h1>
        <p className="text-muted-foreground md:hidden">{ctx.workspace.name}</p>
      </header>

      {ctx.workspace.needsSetup && (
        <section className="flex flex-col gap-4 rounded-2xl border border-primary/40 bg-accent p-5 sm:flex-row sm:items-center">
          <Sparkles className="size-6 shrink-0 text-primary" aria-hidden />
          <div className="flex-1">
            <h2 className="font-semibold">Finish setting up</h2>
            <p className="text-sm text-muted-foreground">
              Answer eight quick questions and we&apos;ll switch on the right tools for you.
            </p>
          </div>
          <Link href="/start?then=welcome" className={buttonVariants({ size: "touch" })}>
            Answer the questions
          </Link>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Paid this month">
          <p className="mt-2 text-2xl font-semibold tracking-tight">{formatMoney(paidThisMonth)}</p>
          <p className="text-sm text-muted-foreground">Fills in as clients pay you.</p>
        </Card>
        <Card title="Owed to you">
          <p className="mt-2 text-2xl font-semibold tracking-tight">{formatMoney(0)}</p>
          <p className="text-sm text-muted-foreground">Nothing overdue.</p>
        </Card>
        <Card title="Monthly goal">
          <div className="mt-2 flex items-center gap-4">
            <GoalRing fraction={paidThisMonth / data.goalCents} />
            <p className="text-sm text-muted-foreground">
              <span className="block text-base font-semibold text-foreground">{formatMoney(paidThisMonth)}</span>
              of {formatMoney(data.goalCents)}
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Setup quest" className="lg:col-span-2">
          <div className="mt-2 flex items-center justify-between gap-4">
            <p className="font-semibold">
              {done === total ? "Quest complete!" : `${done} of ${total} done`}
            </p>
            <span className="text-sm text-muted-foreground">+{QUEST_XP} XP each</span>
          </div>
          <div
            role="progressbar"
            aria-label="Setup quest progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          {done === total ? (
            <p className="mt-4 flex items-center gap-2 text-sm">
              <PartyPopper className="size-5 text-primary" aria-hidden /> Your workspace is ready to go.
            </p>
          ) : (
            <ol className="mt-4 divide-y">
              {data.quest.map((q) => (
                <li key={q.key}>
                  <Link
                    href={questHref(q.key, slug)}
                    className="flex min-h-14 items-center gap-3 py-2 hover:text-primary"
                  >
                    {q.done ? (
                      <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={`block font-medium ${q.done ? "text-muted-foreground line-through" : ""}`}>
                        {QUEST[q.key].title}
                      </span>
                      {!q.done && <span className="block text-sm text-muted-foreground">{QUEST[q.key].body}</span>}
                    </span>
                    <span className="sr-only">{q.done ? "Done" : "To do"}</span>
                    {!q.done && <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Streak">
            <p className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Flame className={`size-6 ${data.streakDays > 0 ? "text-warning" : "text-muted-foreground"}`} aria-hidden />
              {data.streakDays} {data.streakDays === 1 ? "day" : "days"}
            </p>
            <p className="text-sm text-muted-foreground">
              {data.streakDays > 0 ? "Keep it going: do one thing today." : "Do one thing today to start your streak."}{" "}
              {data.xp} XP so far.
            </p>
          </Card>
          <Card title="Needs attention">
            <p className="mt-2 flex items-center gap-2 font-medium">
              <ShieldCheck className="size-5 text-success" aria-hidden /> All clear
            </p>
            <p className="text-sm text-muted-foreground">Nothing needs you right now.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
