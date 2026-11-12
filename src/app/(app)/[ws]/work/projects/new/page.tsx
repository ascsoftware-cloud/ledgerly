import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ProjectForm } from "@/features/work/components/project-form";
import { listClientsForPicker } from "@/features/work/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "New project", robots: { index: false } };

export default function NewProjectPage({ params }: PageProps<"/[ws]/work/projects/new">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <NewProject params={params} />
    </Suspense>
  );
}

async function NewProject({ params }: { params: PageProps<"/[ws]/work/projects/new">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "accountant") notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${ws}/work/projects`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Projects
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
      <ProjectForm slug={ws} clients={await listClientsForPicker(ctx)} />
    </div>
  );
}
