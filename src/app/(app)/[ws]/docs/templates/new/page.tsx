import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { TemplateForm } from "@/features/documents/components/template-form";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "New template", robots: { index: false } };

export default function NewTemplatePage({ params }: PageProps<"/[ws]/docs/templates/new">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <NewTemplate params={params} />
    </Suspense>
  );
}

async function NewTemplate({ params }: { params: PageProps<"/[ws]/docs/templates/new">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "accountant") notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/docs/templates`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Templates
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New template</h1>
      <TemplateForm slug={ws} />
    </div>
  );
}
