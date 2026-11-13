"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { BottomTabs } from "./bottom-tabs";
import { QuickAdd, type QuickAddItem } from "./quick-add";
import type { NavItem } from "./nav";
import { Sidebar } from "./sidebar";

const KEY = "ledgerly-sidebar-collapsed";
const EVENT = "ledgerly:sidebar";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // Storage blocked: start expanded.
  }
}

// Only used when storage is blocked, so the toggle still works for this visit.
let memoryFallback: boolean | null = null;

/** Frame for every signed-in screen: sidebar on desktop, bottom tabs on phones. */
export function AppShell({
  nav,
  title = "Ledgerly",
  titleHref,
  quickAdd = [],
  bell,
  children,
}: {
  nav: NavItem[];
  /** Shown at the top of the sidebar: the workspace name. */
  title?: string;
  /** Where the title links to (the workspace switcher). */
  titleHref?: string;
  /** Shortcuts behind the "+" button. Empty for read-only roles. */
  quickAdd?: QuickAddItem[];
  /** The notification bell, shown in the top corner. */
  bell?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => memoryFallback ?? readCollapsed(),
    () => false,
  );

  function toggle() {
    const next = !collapsed;
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      memoryFallback = next;
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-card focus:px-4 focus:py-3 focus:shadow-raised"
      >
        Skip to content
      </a>
      <Sidebar items={nav} title={title} titleHref={titleHref} collapsed={collapsed} onToggle={toggle} quickAdd={quickAdd} />
      <main id="main" className="min-w-0 flex-1 px-4 pt-6 pb-24 md:px-8 md:pb-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
      {bell && <div className="fixed top-3 right-3 z-40 print:hidden">{bell}</div>}
      <QuickAdd items={quickAdd} variant="fab" />
      <BottomTabs items={nav} />
    </div>
  );
}
