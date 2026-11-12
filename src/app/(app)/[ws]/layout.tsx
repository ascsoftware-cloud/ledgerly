import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceTheme } from "@/features/dashboard/components/workspace-theme";
import { getEnabledNav } from "@/features/dashboard/nav";
import { getNavTabs } from "@/features/integrations/queries";
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
  const tabs = await getNavTabs(ctx.workspace.id);
  const shown = Object.fromEntries(tabs.map((t) => [t.tab, t.shown]));
  return (
    <AppShell
      nav={getEnabledNav(ctx.workspace.slug, ctx.modules, shown)}
      title={ctx.workspace.name}
      titleHref={`/${ctx.workspace.slug}/more`}
      quickAdd={
        ctx.role === "accountant"
          ? []
          : [
              { label: "New invoice", href: `/${ctx.workspace.slug}/money/new?kind=invoice` },
              { label: "New quote", href: `/${ctx.workspace.slug}/money/new?kind=quote` },
              { label: "Add client", href: `/${ctx.workspace.slug}/clients/new` },
              { label: "Add deal", href: `/${ctx.workspace.slug}/clients/pipeline` },
            ]
      }
    >
      <WorkspaceTheme accent={ctx.workspace.accent} mode={ctx.workspace.mode} />
      {children}
    </AppShell>
  );
}
