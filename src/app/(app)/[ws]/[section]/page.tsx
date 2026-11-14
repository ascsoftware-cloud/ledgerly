import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Bell, Blocks, Building2, CalendarClock, CreditCard, Gem, ShieldCheck, Users, Zap } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { getAiStatus } from "@/features/assistant/queries";
import { MikoAvatar } from "@/features/onboarding/components/miko";
import { InstallButton } from "@/components/pwa/pwa-tools";
import { SignOutForm } from "@/components/pwa/sign-out-form";
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
    const [workspaces, tabs, ai] = await Promise.all([listMyWorkspaces(), getNavTabs(ctx.workspace.id), getAiStatus(ctx.workspace.id)]);
    // The phone tab bar fits four sections plus More; the rest are listed here so none are out of reach.
    const nav = getEnabledNav(ctx.workspace.slug, ctx.modules, Object.fromEntries(tabs.map((t) => [t.tab, t.shown])), ctx.role);
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
          <div className="mt-3 border-t pt-3">
            <InstallButton />
          </div>
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

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
              <span className="block text-sm font-normal text-muted-foreground">Xero, Sage and Courier Guy (Shopify coming soon)</span>
            </span>
          </Link>
        )}

        {(ctx.role === "owner" || ctx.role === "admin") && (
          <Link
            href={`/${ctx.workspace.slug}/settings/team`}
            className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
          >
            <Users className="size-5 text-primary" aria-hidden />
            <span className="flex-1">
              Team
              <span className="block text-sm font-normal text-muted-foreground">Invite people, change roles, see the activity log</span>
            </span>
          </Link>
        )}

        <Link
          href={`/${ctx.workspace.slug}/settings/automations`}
          className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
        >
          <Zap className="size-5 text-primary" aria-hidden />
          <span className="flex-1">
            Automations
            <span className="block text-sm font-normal text-muted-foreground">Chase invoices and get alerts by themselves</span>
          </span>
        </Link>

        <Link
          href={`/${ctx.workspace.slug}/settings/notifications`}
          className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
        >
          <Bell className="size-5 text-primary" aria-hidden />
          <span className="flex-1">
            Notification settings
            <span className="block text-sm font-normal text-muted-foreground">Choose what you hear about, and turn on push</span>
          </span>
        </Link>

        <Link
          href={`/${ctx.workspace.slug}/settings/business`}
          className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
        >
          <Building2 className="size-5 text-primary" aria-hidden />
          <span className="flex-1">
            Business details
            <span className="block text-sm font-normal text-muted-foreground">Change your business name, registration and VAT details</span>
          </span>
        </Link>

        <Link
          href={`/${ctx.workspace.slug}/settings/plan`}
          className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
        >
          <Gem className="size-5 text-primary" aria-hidden />
          <span className="flex-1">
            Plan and billing
            <span className="block text-sm font-normal text-muted-foreground">Free or Pro, what you have used, upgrade or cancel</span>
          </span>
        </Link>

        <Link
          href={`/${ctx.workspace.slug}/settings/data`}
          className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
        >
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          <span className="flex-1">
            Your data
            <span className="block text-sm font-normal text-muted-foreground">Download everything, or delete a business or your account</span>
          </span>
        </Link>

        {!ai.enabled && (
          <Link
            href={`/${ctx.workspace.slug}/settings/ai`}
            className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
          >
            <MikoAvatar className="size-6" />
            <span className="flex-1">
              Miko is switched off
              <span className="block text-sm font-normal text-muted-foreground">Switch Miko, your AI helper, back on</span>
            </span>
          </Link>
        )}

        </div>

        <NavTabs slug={ctx.workspace.slug} tabs={tabs} canChange={ctx.role === "owner" || ctx.role === "admin"} />

        <section aria-labelledby="account-heading" className="rounded-2xl border bg-card p-5 shadow-card">
          <h2 id="account-heading" className="text-sm font-medium text-muted-foreground">
            Account
          </h2>
          <p className="mt-2 font-medium">{ctx.user.email}</p>
          <p className="text-sm text-muted-foreground capitalize">{ctx.role}</p>
          <SignOutForm />
        </section>
      </div>
    );
  }

  notFound();
}
