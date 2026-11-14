"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator, ShoppingBag, Truck } from "lucide-react";
import { toast } from "sonner";
import { setNavTab } from "../actions";
import type { NavTab, NavTabState } from "../queries";

const TABS: Record<NavTab, { label: string; body: string; href: string; icon: typeof Truck }> = {
  accounting: {
    label: "Accounting",
    body: "Xero or Sage: what was sent, and anything that needs you",
    href: "accounting",
    icon: Calculator,
  },
  courier: {
    label: "Courier",
    body: "Courier Guy parcels, waybills and tracking",
    href: "courier",
    icon: Truck,
  },
  shopify: {
    label: "Shopify",
    body: "Products, stock and orders from your store",
    href: "shop",
    icon: ShoppingBag,
  },
};

/**
 * The Accounting, Courier and Shopify pages, always reachable from More. Owners and admins can
 * also put each one in the menu (or take it out) for everyone in the workspace.
 */
export function NavTabs({
  slug,
  tabs,
  canChange,
}: {
  slug: string;
  tabs: NavTabState[];
  canChange: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(
    () => Object.fromEntries(tabs.map((t) => [t.tab, t.shown])) as Record<NavTab, boolean>,
  );
  const [pending, start] = useTransition();

  return (
    <section aria-labelledby="tabs-heading" className="rounded-2xl border bg-card p-5 shadow-card">
      <h2 id="tabs-heading" className="text-sm font-medium text-muted-foreground">
        Apps
      </h2>
      <ul className="mt-2 divide-y">
        {tabs.map(({ tab }) => {
          const t = TABS[tab];
          const Icon = t.icon;
          return (
            <li key={tab} className="flex min-h-16 items-center gap-3 py-2">
              <Link
                href={`/${slug}/${t.href}`}
                className="flex flex-1 items-center gap-3 font-medium hover:text-primary"
              >
                <Icon className="size-5 shrink-0 text-primary" aria-hidden />
                <span>
                  {t.label}
                  <span className="block text-sm font-normal text-muted-foreground">{t.body}</span>
                </span>
              </Link>
              {canChange && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="hidden sm:inline">In menu</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={state[tab]}
                    aria-label={`Show ${t.label} in the menu`}
                    disabled={pending}
                    onClick={() => {
                      const next = !state[tab];
                      setState({ ...state, [tab]: next });
                      start(async () => {
                        const r = await setNavTab(slug, tab, next);
                        if (!r.ok) {
                          setState((s) => ({ ...s, [tab]: !next }));
                          toast.error("Couldn't change that. Try again.");
                        } else {
                          toast.success(
                            next
                              ? `${t.label} added to the menu`
                              : `${t.label} removed from the menu`,
                          );
                          router.refresh();
                        }
                      });
                    }}
                    className="relative h-8 w-14 shrink-0 rounded-full bg-muted transition-colors duration-(--dur) aria-checked:bg-primary"
                  >
                    <span
                      aria-hidden
                      className={`absolute top-1 left-1 size-6 rounded-full bg-card shadow-card transition-transform duration-(--dur) ${state[tab] ? "translate-x-6" : ""}`}
                    />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
