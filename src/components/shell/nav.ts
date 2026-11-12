import type { LucideIcon } from "lucide-react";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Module that must be switched on for this item to show. */
  module?: string;
};

/** True when `pathname` is this item's page or a page beneath it. */
export function isActive(
  pathname: string,
  item: Pick<NavItem, "href">,
  items: Pick<NavItem, "href">[],
): boolean {
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  if (!matches(item.href)) return false;
  // When several items match (Home at "/ws" and Money at "/ws/money"), the longest wins.
  return !items.some((other) => other.href.length > item.href.length && matches(other.href));
}
