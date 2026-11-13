import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { PrefRow, PushToggle } from "@/features/notifications/components/notification-tools";
import { getPrefs } from "@/features/notifications/queries";
import { KINDS } from "@/features/notifications/schema";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Notification settings", robots: { index: false } };

export default function NotificationSettingsPage({ params }: PageProps<"/[ws]/settings/notifications">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: { params: PageProps<"/[ws]/settings/notifications">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const prefs = await getPrefs(ctx);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${ws}/notifications`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Notifications
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Notification settings</h1>
      <p className="text-sm text-muted-foreground">These are yours alone: they apply to you in every business you belong to.</p>
      <section aria-labelledby="push-heading" className="space-y-2 rounded-2xl border bg-card p-5 shadow-card">
        <h2 id="push-heading" className="font-semibold">
          Push on this device
        </h2>
        <p className="text-sm text-muted-foreground">Get a notification on your phone or computer even when Ledgerly is closed.</p>
        <PushToggle slug={ws} vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null} />
      </section>
      <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Notification kinds">
        {KINDS.map((k) => (
          <PrefRow key={k} slug={ws} kind={k} enabled={prefs[k].enabled} push={prefs[k].push} />
        ))}
      </ul>
    </div>
  );
}
