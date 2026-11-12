import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { DeleteTask, TaskRow } from "@/features/work/components/task-bits";
import { TaskForm } from "@/features/work/components/task-form";
import { getTask, listMembers, listProjects } from "@/features/work/queries";
import { STATUS_LABEL } from "@/features/work/views";
import { todaySAST } from "@/lib/dates";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Task", robots: { index: false } };
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");

export default function TaskPage({ params }: PageProps<"/[ws]/work/tasks/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Task params={params} />
    </Suspense>
  );
}

async function Task({ params }: { params: PageProps<"/[ws]/work/tasks/[id]">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const [t, projects, members] = await Promise.all([getTask(ctx, id), listProjects(ctx), listMembers(ctx)]);
  if (!t) notFound();
  const canWrite = ctx.role !== "accountant";
  const today = todaySAST();
  const back = t.parent_id ? `/${ws}/work/tasks/${t.parent_id}` : t.project_id ? `/${ws}/work/projects/${t.project_id}` : `/${ws}/work`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={back} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t.parent_id ? "Main task" : t.projects?.name ?? "Work"}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground">{STATUS_LABEL[t.status]}</p>
        </div>
        {canWrite && <DeleteTask slug={ws} taskId={t.id} after={back} />}
      </header>

      {canWrite ? (
        <TaskForm
          key={`${t.id}-${t.title}-${t.due_date}`}
          slug={ws}
          taskId={t.id}
          parentId={t.parent_id}
          projects={projects}
          members={members}
          initial={{ title: t.title, projectId: t.project_id ?? "", assigneeId: t.assignee_id ?? "", dueDate: dmy(t.due_date), priority: t.priority, notes: t.notes ?? "" }}
        />
      ) : (
        t.notes && <p className="whitespace-pre-wrap rounded-2xl border bg-card p-5">{t.notes}</p>
      )}

      {!t.parent_id && (
        <section aria-labelledby="subtasks-heading" className="space-y-3">
          <h2 id="subtasks-heading" className="font-semibold">
            Subtasks
          </h2>
          {t.subtasks.length > 0 && (
            <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Subtasks">
              {t.subtasks.map((s) => (
                <TaskRow key={s.id} slug={ws} canWrite={canWrite} today={today} task={{ ...s, projectName: null }} />
              ))}
            </ul>
          )}
          {canWrite && <TaskForm slug={ws} parentId={t.id} projects={[]} members={members} after={`/${ws}/work/tasks/${t.id}`} />}
        </section>
      )}
    </div>
  );
}
