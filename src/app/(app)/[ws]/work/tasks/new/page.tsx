import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { TaskForm } from "@/features/work/components/task-form";
import { listMembers, listProjects } from "@/features/work/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "New task", robots: { index: false } };

export default function NewTaskPage({ params, searchParams }: PageProps<"/[ws]/work/tasks/new">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <NewTask params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function NewTask({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/work/tasks/new">["params"];
  searchParams: PageProps<"/[ws]/work/tasks/new">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "accountant") notFound();
  const [projects, members] = await Promise.all([listProjects(ctx), listMembers(ctx)]);
  const projectId = typeof sp.project === "string" && projects.some((p) => p.id === sp.project) ? sp.project : "";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${ws}/work`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Work
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New task</h1>
      <TaskForm
        slug={ws}
        projects={projects.filter((p) => p.status === "active")}
        members={members}
        initial={{ title: "", projectId, assigneeId: "", dueDate: "", priority: "normal", notes: "" }}
        after={projectId ? `/${ws}/work/projects/${projectId}` : `/${ws}/work`}
      />
    </div>
  );
}
