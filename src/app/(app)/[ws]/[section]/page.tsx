import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Blocks, Briefcase, CreditCard, LogOut, Package, ShoppingBag } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { signOut } from "@/features/auth/actions";
import { getConnections } from "@/features/integrations/queries";
import { listMyWorkspaces, requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { robots: { index: false } };

/** Sections that arrive in later phases show a clear "on its way" screen, not a 404. */
const COMING = {
  work: { title: "Work", icon: Briefcase, body: "Projects, tasks and bookings are on their way." },
  stock: { title: "Stock", icon: Package, body: "Products and stock levels are on their way." },
} as const;

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
    const [workspaces, apps] = await Promise.all([listMyWorkspaces(), getConnections(ctx)]);
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
            href={`/${ctx.workspace.slug}/settings/integrations`}
            className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
          >
            <Blocks className="size-5 text-primary" aria-hidden />
            <span className="flex-1">
              Apps
              <span className="block text-sm font-normal text-muted-foreground">Xero, Sage, Courier Guy and Shopify</span>
            </span>
          </Link>
        )}

        {apps.shopify && (
          <Link
            href={`/${ctx.workspace.slug}/shop`}
            className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-5 font-medium shadow-card hover:text-primary"
          >
            <ShoppingBag className="size-5 text-primary" aria-hidden />
            <span className="flex-1">
              Shop
              <span className="block text-sm font-normal text-muted-foreground">Products, stock and orders from Shopify</span>
            </span>
          </Link>
        )}

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

  if (!(section in COMING)) notFound();
  const s = COMING[section as keyof typeof COMING];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{s.title}</h1>
      <EmptyState
        icon={s.icon}
        title="On its way"
        body={s.body}
        action={{ label: "Back to home", href: `/${ctx.workspace.slug}` }}
      />
    </div>
  );
}
