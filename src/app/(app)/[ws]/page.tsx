import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { DashboardHome } from "@/features/dashboard/components/dashboard-home";
import { getDashboard } from "@/features/dashboard/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Home", robots: { index: false } };

export default function DashboardPage({ params }: PageProps<"/[ws]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="dashboard" />}>
      <Dashboard params={params} />
    </Suspense>
  );
}

async function Dashboard({ params }: { params: PageProps<"/[ws]">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const data = await getDashboard(ctx);
  return <DashboardHome ctx={ctx} data={data} />;
}
