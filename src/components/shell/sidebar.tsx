"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { isActive, type NavItem } from "./nav";

/** Desktop navigation. Collapses to icons; links keep their names for screen readers. */
export function Sidebar({
  items,
  collapsed,
  onToggle,
}: {
  items: NavItem[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <nav
      aria-label="Sidebar"
      data-collapsed={collapsed}
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-2 border-r bg-card p-3 transition-[width] duration-(--dur) ease-(--ease) data-[collapsed=true]:w-17 md:flex"
    >
      <div className="flex h-11 items-center justify-between gap-2 px-1">
        {!collapsed && (
          <span className="truncate text-lg font-semibold tracking-tight">Ledgerly</span>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ToggleIcon className="size-5" aria-hidden />
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item, items);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={collapsed ? item.label : undefined}
                className="flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
              >
                <item.icon className="size-5 shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
