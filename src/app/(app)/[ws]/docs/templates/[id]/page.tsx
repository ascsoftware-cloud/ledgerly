import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { TemplateForm } from "@/features/documents/components/template-form";
import { getTemplate } from "@/features/documents/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Template", robots: { index: false } };

export default function TemplatePage({ params }: PageProps<"/[ws]/docs/templates/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Template params={params} />
    </Suspense>
  );
}

async function Template({ params }: { params: PageProps<"/[ws]/docs/templates/[id]">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const t = await getTemplate(ctx, id);
  if (!t) notFound();
  const canWrite = ctx.role !== "accountant";
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/docs/templates`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Templates
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
      {canWrite ? (
        <TemplateForm slug={ws} templateId={t.id} initial={{ name: t.name, body: t.body }} />
      ) : (
        <pre className="whitespace-pre-wrap rounded-2xl border bg-card p-5 text-sm shadow-card">{t.body}</pre>
      )}
    </div>
  );
}
