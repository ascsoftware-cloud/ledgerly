import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { AiSwitch } from "@/features/assistant/components/ai-switch";
import { getAiStatus } from "@/features/assistant/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Miko, your AI helper", robots: { index: false } };

export default function AiSettingsPage({ params }: PageProps<"/[ws]/settings/ai">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <AiSettings params={params} />
    </Suspense>
  );
}

async function AiSettings({ params }: { params: PageProps<"/[ws]/settings/ai">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const status = await getAiStatus(ctx.workspace.id);
  const canManage = ctx.role === "owner" || ctx.role === "admin";
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/more`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> More
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Miko, your AI helper</h1>
      <p className="text-sm text-muted-foreground">
        Miko, our meerkat, answers questions about your business in plain English and reads a receipt photo into an expense. Miko is on for every business, and an owner or admin can switch it off here at any time.
      </p>

      <section aria-labelledby="control-heading" className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
        <h2 id="control-heading" className="font-semibold">
          Switch
        </h2>
        {canManage ? <AiSwitch slug={ws} enabled={status.enabled} /> : <p className="text-sm">{status.enabled ? "The AI helper is on for this business." : "The AI helper is off. An owner or admin can switch it on."}</p>}
        {!status.configured && <p className="text-sm text-muted-foreground">It isn&apos;t set up on this server yet, so it won&apos;t answer until it is.</p>}
        <p className="text-sm tabular-nums" aria-label="Usage this month">
          {status.used} of {status.limit} AI requests used this month. {ctx.workspace.plan === "free" ? "The Pro plan allows more." : ""}
        </p>
      </section>

      <section aria-labelledby="data-heading" className="space-y-2 rounded-2xl border bg-card p-5 shadow-card">
        <h2 id="data-heading" className="font-semibold">
          What is sent, and what is not
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Your question, and only the figures and client names it needs (for example the unpaid invoices), go to our AI provider, Groq, to write an answer.</li>
          <li>Client emails, phone numbers and addresses are never sent. Receipt photos are sent only when you press Scan.</li>
          <li>The provider does not keep your requests or use them to train its models by default.</li>
          <li>The assistant can only read. It cannot change, send or delete anything.</li>
          <li>Conversations are not saved: close the panel and they are gone.</li>
        </ul>
      </section>
    </div>
  );
}
