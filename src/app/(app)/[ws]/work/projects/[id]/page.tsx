import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ArchiveProject, ProjectForm } from "@/features/work/components/project-form";
import { QuickAddTask, TaskRow } from "@/features/work/components/task-bits";
import { getProject, listClientsForPicker, listTasks } from "@/features/work/queries";
import { sortForList } from "@/features/work/views";
import { todaySAST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Project", robots: { index: false } };
const rand = (cents: number) => (cents ? (cents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "");

export default function ProjectPage({ params }: PageProps<"/[ws]/work/projects/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Project params={params} />
    </Suspense>
  );
}

async function Project({ params }: { params: PageProps<"/[ws]/work/projects/[id]">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const p = await getProject(ctx, id);
  if (!p) notFound();
  const [tasks, clients] = await Promise.all([listTasks(ctx, { projectId: p.id }), listClientsForPicker(ctx)]);
  const canWrite = ctx.role !== "accountant";
  const canArchive = ctx.role === "owner" || ctx.role === "admin";
  const today = todaySAST();
  const done = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/work/projects`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Projects
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <p className="text-muted-foreground">
            {[p.contacts?.name, p.hourly_rate_cents > 0 && `${formatMoney(p.hourly_rate_cents)} per hour`, `${done} of ${tasks.length} tasks done`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {canArchive && <ArchiveProject slug={ws} projectId={p.id} />}
      </header>

      <section aria-labelledby="project-tasks" className="space-y-3">
        <h2 id="project-tasks" className="font-semibold">
          Tasks
        </h2>
        {canWrite && <QuickAddTask slug={ws} projectId={p.id} />}
        {tasks.length > 0 && (
          <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label={`Tasks for ${p.name}`}>
            {sortForList(tasks).map((t) => (
              <TaskRow key={t.id} slug={ws} canWrite={canWrite} today={today} task={{ ...t, projectName: null }} />
            ))}
          </ul>
        )}
      </section>

      {canWrite && (
        <section aria-labelledby="project-details" className="space-y-3">
          <h2 id="project-details" className="font-semibold">
            Details
          </h2>
          <ProjectForm
            slug={ws}
            projectId={p.id}
            clients={clients}
            initial={{ name: p.name, contactId: p.contact_id ?? "", rate: rand(p.hourly_rate_cents), status: p.status, notes: p.notes ?? "" }}
          />
        </section>
      )}
    </div>
  );
}
