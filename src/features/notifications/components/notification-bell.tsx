"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

/**
 * The bell in the corner. A notification arriving (Supabase Realtime; row-level security still decides what
 * this person receives) shows a small toast and refreshes the page data, which updates the count.
 */
export function NotificationBell({ slug, userId, workspaceId, initialUnread }: { slug: string; userId: string; workspaceId: string; initialUnread: number }) {
  const router = useRouter();
  const unread = initialUnread;

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    void (async () => {
      // Realtime must carry this person's session, or row-level security would (rightly) show it nothing.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`notifications:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
          const n = payload.new as { workspace_id?: string; title?: string; href?: string | null };
          if (n.workspace_id !== workspaceId) return;
          toast(n.title ?? "New notification", {
            action: n.href && n.href.startsWith("/") ? { label: "View", onClick: () => router.push(n.href!) } : undefined,
          });
          router.refresh();
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, workspaceId, router]);

  return (
    <Link
      href={`/${slug}/notifications`}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative flex size-11 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-card hover:text-foreground"
    >
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span aria-hidden className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
