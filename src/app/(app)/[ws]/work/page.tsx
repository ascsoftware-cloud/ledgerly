import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, ListChecks, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { QuickAddTask, TaskRow } from "@/features/work/components/task-bits";
import { WorkTabs } from "@/features/work/components/work-tabs";
import { listProjects, listTasks, type TaskRow as Task } from "@/features/work/queries";
import { boardColumns, calendarWeeks, sortForList } from "@/features/work/views";
import { todaySAST } from "@/lib/dates";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Work", robots: { index: false } };

const VIEWS = [
  { key: "list", label: "List" },
  { key: "board", label: "Board" },
  { key: "calendar", label: "Calendar" },
] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default function WorkPage({ params, searchParams }: PageProps<"/[ws]/work">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Work params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Work({ params, searchParams }: { params: PageProps<"/[ws]/work">["params"]; searchParams: PageProps<"/[ws]/work">["searchParams"] }) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  const today = todaySAST();
  const view = VIEWS.find((v) => v.key === sp.view)?.key ?? "list";
  const mine = sp.who === "me";
  const month = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [tasks, projects] = await Promise.all([listTasks(ctx, { mine }), listProjects(ctx)]);
  const canWrite = ctx.role !== "accountant";
  const href = (over: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { view, who: mine ? "me" : null, month: view === "calendar" ? month : null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "view" && v === "list")) q.set(k, v);
    const s = q.toString();
    return `/${ws}/work${s ? `?${s}` : ""}`;
  };
  const row = (t: Task, showMoves = false) => (
    <TaskRow key={t.id} slug={ws} canWrite={canWrite} today={today} showMoves={showMoves} task={{ ...t, projectName: t.projects?.name ?? null }} />
  );
  const pill = "flex h-11 items-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Work</h1>
        {canWrite && (
          <Link href={`/${ws}/work/tasks/new`} className={buttonVariants({ size: "touch" })}>
            <Plus className="size-5" aria-hidden /> New task
          </Link>
        )}
      </header>
      <WorkTabs slug={ws} current="tasks" />
      {canWrite && <QuickAddTask slug={ws} />}

      <div className="flex flex-wrap gap-3">
        <nav aria-label="Task views" className="inline-flex rounded-xl bg-muted p-1">
          {VIEWS.map((v) => (
            <Link key={v.key} href={href({ view: v.key })} aria-current={view === v.key ? "page" : undefined} className={pill}>
              {v.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Whose tasks" className="inline-flex rounded-xl bg-muted p-1">
          <Link href={href({ who: null })} aria-current={!mine ? "page" : undefined} className={pill}>
            Everyone
          </Link>
          <Link href={href({ who: "me" })} aria-current={mine ? "page" : undefined} className={pill}>
            Mine
          </Link>
        </nav>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={mine ? "Nothing assigned to you" : "No tasks yet"}
          body="Write down what needs doing, give it a date if it has one, and tick it off when it is done."
          action={canWrite ? { label: "Add your first task", href: `/${ws}/work/tasks/new` } : { label: "Back to home", href: `/${ws}` }}
        />
      ) : view === "list" ? (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Tasks">
          {sortForList(tasks).map((t) => row(t))}
        </ul>
      ) : view === "board" ? (
        <div className="grid gap-4 md:grid-cols-3">
          {boardColumns(tasks).map((col) => (
            <section key={col.key} aria-label={col.label} className="rounded-2xl bg-muted/60 p-2">
              <h2 className="px-2 py-2 text-sm font-semibold">
                {col.label} <span className="font-normal text-muted-foreground">{col.tasks.length}</span>
              </h2>
              <ul className="divide-y rounded-xl border bg-card">{col.tasks.map((t) => row(t, true))}</ul>
            </section>
          ))}
        </div>
      ) : (
        <section aria-label="Calendar" className="space-y-3">
          <div className="flex items-center gap-1">
            <Link href={href({ month: shift(month, -1) })} aria-label="Previous month" className={buttonVariants({ variant: "ghost", size: "icon-touch" })}>
              <ChevronLeft className="size-5" aria-hidden />
            </Link>
            <h2 className="min-w-36 text-center font-semibold">
              {MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}
            </h2>
            <Link href={href({ month: shift(month, 1) })} aria-label="Next month" className={buttonVariants({ variant: "ghost", size: "icon-touch" })}>
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          </div>
          <div className="grid grid-cols-7 overflow-hidden rounded-2xl border bg-card text-xs shadow-card" role="grid">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} role="columnheader" className="border-b bg-muted/60 px-1 py-2 text-center font-medium">
                {d}
              </div>
            ))}
            {calendarWeeks(month, tasks).flat().map((day) => (
              <div
                key={day.date}
                role="gridcell"
                aria-label={`${day.date}${day.tasks.length ? `, ${day.tasks.length} due` : ""}`}
                className={`min-h-20 border-b border-r p-1 ${day.inMonth ? "" : "bg-muted/40 text-muted-foreground"} ${day.date === today ? "ring-2 ring-primary ring-inset" : ""}`}
              >
                <span className="block text-right">{Number(day.date.slice(8))}</span>
                {day.tasks.map((t) => (
                  <Link
                    key={t.id}
                    href={`/${ws}/work/tasks/${t.id}`}
                    className={`mt-1 block truncate rounded px-1 py-0.5 ${t.status === "done" ? "text-muted-foreground line-through" : "bg-accent font-medium"}`}
                  >
                    {t.title}
                  </Link>
                ))}
              </div>
            ))}
          </div>
          {tasks.some((t) => !t.due_date) && (
            <p className="text-sm text-muted-foreground">Tasks without a due date are in the list view.</p>
          )}
        </section>
      )}
      {projects.length === 0 && canWrite && tasks.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Group tasks for a job into a <Link href={`/${ws}/work/projects/new`} className="underline">project</Link>.
        </p>
      )}
    </div>
  );
}
