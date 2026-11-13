import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Blocks, CalendarClock, CreditCard, LogOut } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { signOut } from "@/features/auth/actions";
import { getEnabledNav } from "@/features/dashboard/nav";
import { NavTabs } from "@/features/integrations/components/nav-tabs";
import { getNavTabs } from "@/features/integrations/queries";
import { listMyWorkspaces, requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { robots: { index: false } };

export default function SectionPage({ params }: PageProps<"/[ws]/[section]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Section params={params} />
    </Suspense>
  );
}

async function Section({ params }: { params: PageProps<"/[ws]/[section]">["params"] }) {
  const { ws, section } = await params;
  const ctx = await requireWorkspace(ws);

  if (section === "more") {
    const [workspaces, tabs] = await Promise.all([listMyWorkspaces(), getNavTabs(ctx.workspace.id)]);
    // The phone tab bar fits four sections plus More; the rest are listed here so none are out of reach.
    const nav = getEnabledNav(ctx.workspace.slug, ctx.modules, Object.fromEntries(tabs.map((t) => [t.tab, t.shown])));
    const overflow = nav.length > 5 ? nav.slice(4, -1) : [];
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">More</h1>

        <section aria-labelledby="ws-heading" className="rounded-2xl border bg-card p-5 shadow-card">
          <h2 id="ws-heading" className="text-sm font-medium text-muted-foreground">
            Your workspaces
          </h2>
          <ul className="mt-2 divide-y">
            {workspaces.map((w) => (
              <li key={w.slug}>
                <Link
                  href={`/${w.slug}`}
                  aria-current={w.slug === ctx.workspace.slug ? "page" : undefined}
                  className="flex min-h-12 items-center justify-between gap-3 py-2 font-medium hover:text-primary aria-[current=page]:text-primary"
                >
                  {w.name}
                  {w.slug === ctx.workspace.slug && <span className="text-sm text-muted-foreground">Current</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {overflow.length > 0 && (
          <section aria-labelledby="sections-heading" className="rounded-2xl border bg-card p-5 shadow-card md:hidden">
            <h2 id="sections-heading" className="text-sm font-medium text-muted-foreground">
              More sections
            </h2>
            <ul className="mt-2 divide-y">
              {overflow.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="flex min-h-12 items-center py-2 font-medium hover:text-primary">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(ctx.role === "owner" || ctx.role === "admin") && (
          <Link
            href={`/${ctx.workspace.slug}/settings/payments`}
            className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
          >
            <CreditCard className="size-5 text-primary" aria-hidden />
            <span className="flex-1">
              Getting paid
              <span className="block text-sm font-normal text-muted-foreground">Bank details for EFT, Yoco, PayFast and Stitch</span>
            </span>
          </Link>
        )}
        {(ctx.role === "owner" || ctx.role === "admin") && (
          <Link
            href={`/${ctx.workspace.slug}/settings/bookings`}
            className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
          >
            <CalendarClock className="size-5 text-primary" aria-hidden />
            <span className="flex-1">
              Booking page
              <span className="block text-sm font-normal text-muted-foreground">Services, opening hours and your public booking link</span>
            </span>
          </Link>
        )}

        {(ctx.role === "owner" || ctx.role === "admin") && (
          <Link
            href={`/${ctx.workspace.slug}/settings/integrations`}
            className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
          >
            <Blocks className="size-5 text-primary" aria-hidden />
            <span className="flex-1">
              Connect apps
              <span className="block text-sm font-normal text-muted-foreground">Xero, Sage, Courier Guy and Shopify</span>
            </span>
          </Link>
        )}

        <NavTabs slug={ctx.workspace.slug} tabs={tabs} canChange={ctx.role === "owner" || ctx.role === "admin"} />

        <section aria-labelledby="account-heading" className="rounded-2xl border bg-card p-5 shadow-card">
          <h2 id="account-heading" className="text-sm font-medium text-muted-foreground">
            Account
          </h2>
          <p className="mt-2 font-medium">{ctx.user.email}</p>
          <p className="text-sm text-muted-foreground capitalize">{ctx.role}</p>
          <form action={signOut} className="mt-4">
            <button type="submit" className={buttonVariants({ variant: "outline", size: "touch" })}>
              <LogOut className="size-5" aria-hidden />
              Sign out
            </button>
          </form>
        </section>

        <p className="text-sm text-muted-foreground">Settings, team and billing arrive in later updates.</p>
      </div>
    );
  }

  notFound();
}
