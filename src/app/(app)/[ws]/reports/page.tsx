import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ExportLinks, PeriodPicker, ReportTabs, ReportView } from "@/features/reports/components/report-view";
import { loadReport } from "@/features/reports/queries";
import { isReportKind, resolvePeriod } from "@/features/reports/schema";
import { formatDate, todaySAST } from "@/lib/dates";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Reports", robots: { index: false } };

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default function ReportsPage({ params, searchParams }: PageProps<"/[ws]/reports">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Reports params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Reports({ params, searchParams }: { params: PageProps<"/[ws]/reports">["params"]; searchParams: PageProps<"/[ws]/reports">["searchParams"] }) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  // Staff have no reports (spec section 3); the database refuses them as well.
  if (ctx.role === "staff") notFound();

  const today = todaySAST();
  const kind = isReportKind(first(sp.r)) ? (first(sp.r) as "pnl" | "vat" | "aged" | "cashflow") : "pnl";
  const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) }, today);
  const report = await loadReport(ctx, kind, period, today);
  const asAt = kind === "aged" || kind === "cashflow";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        {report && <ExportLinks ws={ws} kind={kind} period={period} />}
      </header>
      <ReportTabs ws={ws} current={kind} period={period} />
      {asAt ? (
        <p className="text-sm text-muted-foreground">As at {formatDate(today)}.</p>
      ) : (
        <>
          <PeriodPicker ws={ws} kind={kind} period={period} />
          <p className="text-sm font-medium">{period.label}</p>
        </>
      )}
      {report ? (
        <ReportView report={report} label={asAt ? formatDate(today) : period.label} />
      ) : (
        <EmptyState icon={BarChart3} title="Couldn't load this report" body="Try again in a moment. If it keeps happening, your role may not allow reports." action={{ label: "Back to home", href: `/${ws}` }} />
      )}
    </div>
  );
}
