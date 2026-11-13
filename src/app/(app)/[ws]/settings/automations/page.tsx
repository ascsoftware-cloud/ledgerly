import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Zap } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { RuleControls, RuleForm } from "@/features/automations/components/automation-tools";
import { listRules, listRuns } from "@/features/automations/queries";
import { describeRule } from "@/features/automations/schema";
import { nowMs, timeAgo } from "@/features/notifications/schema";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Automations", robots: { index: false } };

export default function AutomationsPage({ params }: PageProps<"/[ws]/settings/automations">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Automations params={params} />
    </Suspense>
  );
}

async function Automations({ params }: { params: PageProps<"/[ws]/settings/automations">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const canManage = ctx.role === "owner" || ctx.role === "admin";
  const [rules, runs] = await Promise.all([listRules(ctx), listRuns(ctx)]);
  const now = nowMs();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/more`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> More
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
      <p className="text-sm text-muted-foreground">Let Ledgerly do the chasing. Each rule is checked every hour and acts once for each invoice, quote, product, booking or task it matches.</p>

      {rules.length === 0 ? (
        <EmptyState icon={Zap} title="No automations yet" body="For example: when an invoice is 3 days overdue, email the client a reminder." action={canManage ? { label: "Add the first rule", href: "#new-rule" } : { label: "Back to More", href: `/${ws}/more` }} />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Rules">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{r.name}</span>
                <span className="block text-sm text-muted-foreground">{describeRule(r)}</span>
              </span>
              {canManage ? <RuleControls slug={ws} id={r.id} name={r.name} enabled={r.enabled} /> : <span className="text-sm text-muted-foreground">{r.enabled ? "On" : "Off"}</span>}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <section id="new-rule" aria-labelledby="new-heading" className="space-y-3">
          <h2 id="new-heading" className="font-semibold">
            Add a rule
          </h2>
          <RuleForm slug={ws} />
        </section>
      )}

      <section aria-labelledby="log-heading" className="space-y-2">
        <h2 id="log-heading" className="font-semibold">
          What happened
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has run yet. When a rule acts, it is listed here.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Run log">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{r.automation_rules?.name ?? "A rule"}</span>
                  <span className={r.outcome === "failed" ? "text-destructive" : "text-muted-foreground"}> · {r.outcome === "failed" ? "Couldn't act: " : ""}{r.detail ?? "Done"}</span>
                </span>
                <span className="text-muted-foreground tabular-nums">{timeAgo(r.created_at, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
