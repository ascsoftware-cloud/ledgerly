import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FolderKanban, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { WorkTabs } from "@/features/work/components/work-tabs";
import { listProjects, listTasks } from "@/features/work/queries";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Projects", robots: { index: false } };

export default function ProjectsPage({ params }: PageProps<"/[ws]/work/projects">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Projects params={params} />
    </Suspense>
  );
}

async function Projects({ params }: { params: PageProps<"/[ws]/work/projects">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const [projects, tasks] = await Promise.all([listProjects(ctx), listTasks(ctx)]);
  const canWrite = ctx.role !== "accountant";
  const open = (id: string) => tasks.filter((t) => t.project_id === id && t.status !== "done").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Work</h1>
        {canWrite && (
          <Link href={`/${ws}/work/projects/new`} className={buttonVariants({ size: "touch" })}>
            <Plus className="size-5" aria-hidden /> New project
          </Link>
        )}
      </header>
      <WorkTabs slug={ws} current="projects" />
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          body="A project groups the tasks and hours for one job, so you can see what is left and bill the time."
          action={canWrite ? { label: "Start a project", href: `/${ws}/work/projects/new` } : { label: "Back to tasks", href: `/${ws}/work` }}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Projects">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/${ws}/work/projects/${p.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {[p.contacts?.name, p.hourly_rate_cents > 0 && `${formatMoney(p.hourly_rate_cents)}/h`].filter(Boolean).join(" · ") || "No client"}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">{p.status === "done" ? "Finished" : `${open(p.id)} open`}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
