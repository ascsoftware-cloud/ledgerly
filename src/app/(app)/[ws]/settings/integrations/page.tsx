import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { IntegrationsSettings } from "@/features/integrations/components/integrations-settings";
import { failedJobs, getConnections } from "@/features/integrations/queries";
import { requireWorkspace } from "@/lib/workspace";
import { mappingOptions } from "@/server/integrations/accounting-service";
import { sageApiKey, shopifyApp, xeroApp } from "@/server/integrations/env";

export const metadata: Metadata = { title: "Apps", robots: { index: false } };

const NOTICE: Record<string, string> = {
  "connected=xero":
    "Xero connected. Choose the accounts below so Ledgerly knows where to put things.",
  "connected=sage_za": "Sage connected.",
  "connected=shopify":
    "Shopify connected. Your products and orders are loading; the first refresh takes a few minutes.",
  "warn=webhooks":
    "Live updates from Shopify could not be switched on, so the Shop page refreshes every 6 hours instead.",
  "error=state":
    "That sign-in link expired or was started somewhere else. Start again from this page.",
  "error=role": "Only owners and admins can connect apps.",
  "error=xero": "Xero didn't finish connecting. Try again.",
  "error=xero-declined": "Xero wasn't connected: access was not allowed.",
  "error=xero-no-org": "No Xero organisation was chosen. Connect again and pick one.",
  "error=xero-not-configured": "Xero isn't switched on for this Ledgerly server yet.",
  "error=shopify": "Shopify didn't finish connecting. Try again.",
  "error=shopify-scopes":
    "Shopify was connected without permission to read products, stock and orders. Connect again and allow them.",
  "error=shopify-not-configured": "Shopify isn't switched on for this Ledgerly server yet.",
  "error=shop": "That doesn't look like a Shopify store address. Use your-store.myshopify.com.",
  "error=shop-taken": "That Shopify store is already connected to another Ledgerly workspace.",
  "error=save": "The app connected but Ledgerly couldn't save it. Try again.",
};

export default function IntegrationsPage({
  params,
  searchParams,
}: PageProps<"/[ws]/settings/integrations">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Integrations params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Integrations({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/settings/integrations">["params"];
  searchParams: PageProps<"/[ws]/settings/integrations">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  if (ctx.role !== "owner" && ctx.role !== "admin") notFound();
  const [connections, failed] = await Promise.all([getConnections(ctx), failedJobs(ctx)]);
  const [xeroOptions, sageOptions] = await Promise.all([
    connections.xero?.status === "active"
      ? mappingOptions(ctx.workspace.id, connections.xero.id)
      : Promise.resolve(null),
    connections.sage_za?.status === "active"
      ? mappingOptions(ctx.workspace.id, connections.sage_za.id)
      : Promise.resolve(null),
  ]);
  const notices = Object.entries(sp)
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => NOTICE[`${k}=${v}`])
    .filter((n): n is string => Boolean(n));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/${ws}/more`}
        className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> More
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
        <p className="text-muted-foreground">
          Connect your accounting, courier and online store. Each one is optional.
        </p>
      </div>
      {notices.map((n) => (
        <p key={n} role="status" className="rounded-xl bg-accent px-4 py-3 text-sm">
          {n}
        </p>
      ))}
      <IntegrationsSettings
        slug={ws}
        connections={connections}
        failed={failed}
        options={{ xero: xeroOptions, sage_za: sageOptions }}
        available={{ xero: !!xeroApp(), shopify: !!shopifyApp(), sage_za: !!sageApiKey() }}
      />
    </div>
  );
}
