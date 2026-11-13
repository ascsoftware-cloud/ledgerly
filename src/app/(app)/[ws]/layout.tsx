import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { AppShell } from "@/components/shell/app-shell";
import { AssistantPanel } from "@/features/assistant/components/assistant-panel";
import { getAiStatus } from "@/features/assistant/queries";
import { WorkspaceTheme } from "@/features/dashboard/components/workspace-theme";
import { getEnabledNav } from "@/features/dashboard/nav";
import { CommandCenter } from "@/features/search/components/command-center";
import { getNavTabs } from "@/features/integrations/queries";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { unreadCount } from "@/features/notifications/queries";
import { requireWorkspace } from "@/lib/workspace";

export default function WorkspaceLayout({ children, params }: LayoutProps<"/[ws]">) {
  // Everything here reads the session, so it streams in behind a boundary.
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-5xl px-4 pt-6 md:px-8">
          <PageSkeleton variant="dashboard" />
        </main>
      }
    >
      <WorkspaceFrame params={params}>{children}</WorkspaceFrame>
    </Suspense>
  );
}

async function WorkspaceFrame({
  params,
  children,
}: {
  params: LayoutProps<"/[ws]">["params"];
  children: ReactNode;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const [tabs, unread, ai] = await Promise.all([getNavTabs(ctx.workspace.id), unreadCount(ctx), getAiStatus(ctx.workspace.id)]);
  const shown = Object.fromEntries(tabs.map((t) => [t.tab, t.shown]));
  const nav = getEnabledNav(ctx.workspace.slug, ctx.modules, shown, ctx.role);
  return (
    <AppShell
      nav={nav}
      bell={
        <>
          <CommandCenter slug={ctx.workspace.slug} nav={nav.map((n) => ({ key: n.key, href: n.href }))} canCreate={ctx.role !== "accountant"} />
          {ai.enabled && ai.configured && <AssistantPanel slug={ctx.workspace.slug} used={ai.used} limit={ai.limit} />}
          <NotificationBell slug={ctx.workspace.slug} userId={ctx.user.id} workspaceId={ctx.workspace.id} initialUnread={unread} />
        </>
      }
      title={ctx.workspace.name}
      titleHref={`/${ctx.workspace.slug}/more`}
      quickAdd={
        ctx.role === "accountant"
          ? []
          : [
              { label: "New invoice", href: `/${ctx.workspace.slug}/money/new?kind=invoice` },
              { label: "New quote", href: `/${ctx.workspace.slug}/money/new?kind=quote` },
              { label: "Add client", href: `/${ctx.workspace.slug}/clients/new` },
              { label: "Log expense", href: `/${ctx.workspace.slug}/money/expenses/new` },
              { label: "Add task", href: `/${ctx.workspace.slug}/work/tasks/new` },
              { label: "Add deal", href: `/${ctx.workspace.slug}/clients/pipeline` },
            ]
      }
    >
      <WorkspaceTheme accent={ctx.workspace.accent} mode={ctx.workspace.mode} />
      {children}
    </AppShell>
  );
}
