import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { getAiStatus } from "@/features/assistant/queries";
import { AddBusinessForm, CancelPlanButton, UpgradeButton } from "@/features/billing/components/plan-tools";
import { getPlanPage } from "@/features/billing/queries";
import { formatDate } from "@/lib/dates";
import { formatBytes, formatPrice, PLANS, storageLimitBytes } from "@/lib/plans";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Plan and billing", robots: { index: false } };

export default function PlanPage({ params, searchParams }: PageProps<"/[ws]/settings/plan">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Plan params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Meter({ label, used, limit, text }: { label: string; used: number; limit: number | null; text: string }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <li className="space-y-1">
      <div className="flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{text}</span>
      </div>
      {limit !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  );
}

async function Plan({ params, searchParams }: { params: PageProps<"/[ws]/settings/plan">["params"]; searchParams: PageProps<"/[ws]/settings/plan">["searchParams"] }) {
  const { ws } = await params;
  const { paid } = await searchParams;
  const ctx = await requireWorkspace(ws);
  const [page, ai] = await Promise.all([getPlanPage(ctx), getAiStatus(ctx.workspace.id)]);
  const plan = ctx.workspace.plan;
  const isOwner = ctx.role === "owner";
  const limits = PLANS[plan];
  const sub = page.subscription;
  const endsOn = sub ? formatDate(sub.periodEnd.slice(0, 10)) : "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/more`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> More
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Plan and billing</h1>

      {paid === "1" && plan === "free" && (
        <p role="status" className="rounded-2xl border bg-card p-4 text-sm">
          Thank you. PayFast is confirming your payment. This page updates in a minute or two.
        </p>
      )}

      <section aria-labelledby="plan-heading" className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
        <h2 id="plan-heading" className="font-semibold">
          Your plan: {limits.name}
        </h2>
        {plan === "pro" ? (
          <p className="text-sm text-muted-foreground">
            {sub?.status === "cancelling"
              ? `Pro ends on ${endsOn}. After that this business goes back to Free. Nothing is deleted or hidden.`
              : sub
                ? `${formatPrice(PLANS.pro.priceCents)} a month. Next payment around ${endsOn}.`
                : "Pro is on for this business."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Free works for a small business just starting out. Pro is {formatPrice(PLANS.pro.priceCents)} a month for the whole business, with unlimited people.
          </p>
        )}

        {isOwner && plan === "free" &&
          (page.billingOn ? (
            <UpgradeButton slug={ws} price={formatPrice(PLANS.pro.priceCents)} />
          ) : (
            <p className="text-sm text-muted-foreground">Paying for Pro isn&apos;t switched on yet. Please check back soon.</p>
          ))}
        {isOwner && plan === "pro" && sub?.status === "active" && <CancelPlanButton slug={ws} endsOn={endsOn} />}
        {!isOwner && <p className="text-sm text-muted-foreground">Only the owner can change the plan.</p>}
      </section>

      <section aria-labelledby="use-heading" className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
        <h2 id="use-heading" className="font-semibold">
          What you&apos;ve used
        </h2>
        <ul className="space-y-3" aria-label="Usage">
          <Meter
            label="Invoices and quotes sent this month"
            used={page.usage.documentsSent}
            limit={limits.documentsPerMonth}
            text={limits.documentsPerMonth === null ? `${page.usage.documentsSent} (no limit)` : `${page.usage.documentsSent} of ${limits.documentsPerMonth}`}
          />
          <Meter label="Storage" used={page.usage.storageUsed} limit={storageLimitBytes(plan)} text={`${formatBytes(page.usage.storageUsed)} of ${formatBytes(storageLimitBytes(plan))}`} />
          <Meter label="AI requests this month" used={ai.used} limit={ai.limit} text={`${ai.used} of ${ai.limit}`} />
        </ul>
        <p className="text-sm text-muted-foreground">Going over a limit never hides or blocks your data: you can always view and download everything.</p>
      </section>

      <section aria-labelledby="compare-heading" className="space-y-2 rounded-2xl border bg-card p-5 shadow-card">
        <h2 id="compare-heading" className="font-semibold">
          Free and Pro
        </h2>
        <table className="w-full text-sm">
          <caption className="sr-only">What each plan includes</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1 font-medium"></th>
              <th scope="col" className="py-1 font-medium">Free</th>
              <th scope="col" className="py-1 font-medium">Pro</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr><th scope="row" className="py-2 text-left font-normal">Price</th><td>R0</td><td>{formatPrice(PLANS.pro.priceCents)} a month</td></tr>
            <tr><th scope="row" className="py-2 text-left font-normal">Invoices and quotes</th><td>10 a month</td><td>Unlimited</td></tr>
            <tr><th scope="row" className="py-2 text-left font-normal">Storage</th><td>200 MB</td><td>10 GB</td></tr>
            <tr><th scope="row" className="py-2 text-left font-normal">AI requests</th><td>20 a month</td><td>300 a month</td></tr>
            <tr><th scope="row" className="py-2 text-left font-normal">Automations</th><td>No</td><td>Yes</td></tr>
            <tr><th scope="row" className="py-2 text-left font-normal">Customer portal</th><td>No</td><td>Yes</td></tr>
            <tr><th scope="row" className="py-2 text-left font-normal">&ldquo;Sent with Ledgerly&rdquo; footer</th><td>Shown</td><td>Hidden</td></tr>
            <tr><th scope="row" className="py-2 text-left font-normal">More than one business</th><td>No</td><td>Yes</td></tr>
            <tr><th scope="row" className="py-2 text-left font-normal">People on your team</th><td>Unlimited</td><td>Unlimited</td></tr>
          </tbody>
        </table>
      </section>

      {isOwner && plan === "pro" && (
        <section aria-labelledby="more-heading" className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
          <h2 id="more-heading" className="font-semibold">
            Add another business
          </h2>
          <p className="text-sm text-muted-foreground">You own {page.usage.ownedWorkspaces} of up to 10. Each one starts on Free and has its own plan.</p>
          <AddBusinessForm slug={ws} />
        </section>
      )}
    </div>
  );
}
