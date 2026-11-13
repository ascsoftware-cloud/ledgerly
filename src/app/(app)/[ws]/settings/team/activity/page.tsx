import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, History } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { listAudit } from "@/features/team/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Activity log", robots: { index: false } };

const when = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export default function ActivityPage({ params }: PageProps<"/[ws]/settings/team/activity">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Activity params={params} />
    </Suspense>
  );
}

async function Activity({ params }: { params: PageProps<"/[ws]/settings/team/activity">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role !== "owner" && ctx.role !== "admin") notFound();
  const entries = await listAudit(ctx);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/settings/team`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Team
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Activity log</h1>
      <p className="text-sm text-muted-foreground">Who joined, left or changed roles, and the important changes to money and stock. It cannot be edited.</p>
      {entries.length === 0 ? (
        <EmptyState icon={History} title="Nothing yet" body="Changes to your team, invoices, payments and stock will be listed here." action={{ label: "Back to team", href: `/${ws}/settings/team` }} />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Activity">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <span>{e.summary}</span>
              <time dateTime={e.created_at} className="text-sm text-muted-foreground tabular-nums">
                {when.format(new Date(e.created_at))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
