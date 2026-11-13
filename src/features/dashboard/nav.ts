import type { NavItem } from "@/components/shell/nav";

/** Extra tabs for the outside apps (see migration 0056: defaults by business type, set in More). */
export type ExtraTabs = { accounting?: boolean; courier?: boolean; shopify?: boolean };

/** The sections a workspace shows, driven by the modules it has switched on. */
export function getEnabledNav(slug: string, modules: readonly string[], extra: ExtraTabs = {}, role?: "owner" | "admin" | "staff" | "accountant"): NavItem[] {
  const on = (...m: string[]) => m.some((x) => modules.includes(x));
  const base = `/${slug}`;
  const items: (NavItem | false)[] = [
    { key: "home", label: "Home", href: base, icon: "home" },
    on("invoices", "expenses") && { key: "money", label: "Money", href: `${base}/money`, icon: "wallet" },
    on("clients") && { key: "clients", label: "Clients", href: `${base}/clients`, icon: "users" },
    on("projects", "bookings") && { key: "work", label: "Work", href: `${base}/work`, icon: "briefcase" },
    on("inventory") && { key: "stock", label: "Stock", href: `${base}/stock`, icon: "package" },
    // Reports are for owners, admins and accountants (spec section 3).
    (role === "owner" || role === "admin" || role === "accountant") &&
      on("invoices", "expenses", "reports") && { key: "reports", label: "Reports", href: `${base}/reports`, icon: "chart" },
    !!extra.accounting && { key: "accounting", label: "Accounting", href: `${base}/accounting`, icon: "calculator" },
    !!extra.courier && { key: "courier", label: "Courier", href: `${base}/courier`, icon: "truck" },
    !!extra.shopify && { key: "shopify", label: "Shopify", href: `${base}/shop`, icon: "shopping-bag" },
    { key: "more", label: "More", href: `${base}/more`, icon: "menu" },
  ];
  return items.filter((i): i is NavItem => i !== false);
}
