/** Icon names rather than components, so nav lists can be built on the server. */
export type IconName = "home" | "wallet" | "users" | "briefcase" | "package" | "menu";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: IconName;
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

/** The phone tab bar fits five: the first four, plus the last item ("More"). */
export function pickTabs<T>(items: T[]): T[] {
  if (items.length <= 5) return items;
  return [...items.slice(0, 4), items[items.length - 1]!];
}
