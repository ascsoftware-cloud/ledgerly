import type { NavItem } from "@/components/shell/nav";

/** The sections a workspace shows, driven by the modules it has switched on. */
export function getEnabledNav(slug: string, modules: readonly string[]): NavItem[] {
  const on = (...m: string[]) => m.some((x) => modules.includes(x));
  const base = `/${slug}`;
  const items: (NavItem | false)[] = [
    { key: "home", label: "Home", href: base, icon: "home" },
    on("invoices", "expenses") && { key: "money", label: "Money", href: `${base}/money`, icon: "wallet" },
    on("clients") && { key: "clients", label: "Clients", href: `${base}/clients`, icon: "users" },
    on("projects", "bookings") && { key: "work", label: "Work", href: `${base}/work`, icon: "briefcase" },
    on("inventory") && { key: "stock", label: "Stock", href: `${base}/stock`, icon: "package" },
    { key: "more", label: "More", href: `${base}/more`, icon: "menu" },
  ];
  return items.filter((i): i is NavItem => i !== false);
}
