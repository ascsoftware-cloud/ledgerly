import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileText, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { DocSections } from "@/features/documents/components/doc-sections";
import { listTemplates } from "@/features/documents/queries";
import { customFields } from "@/features/documents/schema";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Contract templates", robots: { index: false } };

export default function TemplatesPage({ params }: PageProps<"/[ws]/docs/templates">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Templates params={params} />
    </Suspense>
  );
}

async function Templates({ params }: { params: PageProps<"/[ws]/docs/templates">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const canWrite = ctx.role !== "accountant";
  const templates = await listTemplates(ctx);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        {canWrite && (
          <Link href={`/${ws}/docs/templates/new`} className={buttonVariants({ size: "touch" })}>
            <Plus className="size-5" aria-hidden /> New template
          </Link>
        )}
      </header>
      <DocSections slug={ws} current="templates" />
      {templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates yet"
          body="Write an agreement once, with fields for the client and the details. Then make a new contract in a few taps."
          action={{ label: "Write a template", href: `/${ws}/docs/templates/new` }}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Templates">
          {templates.map((t) => (
            <li key={t.id}>
              <Link href={`/${ws}/docs/templates/${t.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:text-primary">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {customFields(t.body).length ? `Asks for: ${customFields(t.body).map((f) => f.replace(/_/g, " ")).join(", ")}` : "No extra details to fill in"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
