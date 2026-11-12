"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, type NavItem } from "./nav";

/** Phone navigation: up to five destinations along the bottom edge. */
export function BottomTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const tabs = items.slice(0, 5);
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-lg">
        {tabs.map((item) => {
          const active = isActive(pathname, item, tabs);
          return (
            <li key={item.key} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground transition-colors duration-(--dur-fast) aria-[current=page]:text-primary"
              >
                <item.icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
