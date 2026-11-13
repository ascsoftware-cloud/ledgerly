import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bell, Settings } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { MarkAllRead, NotificationLink } from "@/features/notifications/components/notification-tools";
import { listNotifications } from "@/features/notifications/queries";
import { kindLabel, nowMs, timeAgo } from "@/features/notifications/schema";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Notifications", robots: { index: false } };

export default function NotificationsPage({ params }: PageProps<"/[ws]/notifications">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Notifications params={params} />
    </Suspense>
  );
}

async function Notifications({ params }: { params: PageProps<"/[ws]/notifications">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const items = await listNotifications(ctx);
  const now = nowMs();
  const unread = items.filter((n) => n.read_at === null).length;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <div className="flex flex-wrap items-center gap-2">
          <MarkAllRead slug={ws} disabled={unread === 0} />
          <Link href={`/${ws}/settings/notifications`} aria-label="Notification settings" className="inline-flex size-11 items-center justify-center rounded-xl border hover:bg-muted">
            <Settings className="size-5" aria-hidden />
          </Link>
        </div>
      </header>
      {items.length === 0 ? (
        <EmptyState icon={Bell} title="Nothing yet" body="You will see payments, opened invoices, bookings, low stock and tasks here as they happen." action={{ label: "Back to home", href: `/${ws}` }} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-card" aria-label="Notifications">
          {items.map((n) => (
            <li key={n.id}>
              <NotificationLink slug={ws} id={n.id} href={n.href} unread={n.read_at === null}>
                <span className="block">{n.title}</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  {kindLabel(n.kind)} · {timeAgo(n.created_at, now)}
                </span>
              </NotificationLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
