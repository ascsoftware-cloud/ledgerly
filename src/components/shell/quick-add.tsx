"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, X } from "lucide-react";

export type QuickAddItem = { label: string; href: string };

/** "+" from anywhere: start an invoice, quote, client or deal in one tap. */
export function QuickAdd({ items, variant }: { items: QuickAddItem[]; variant: "fab" | "sidebar" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);

  // Close after navigating (state adjusted during render, not in an effect).
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (!items.length) return null;
  const Icon = open ? X : Plus;

  return (
    <div
      ref={ref}
      className={variant === "fab" ? "fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 md:hidden" : "relative"}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={open ? "Close quick add" : "Quick add"}
        onClick={() => setOpen(!open)}
        className={
          variant === "fab"
            ? "flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-overlay"
            : "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"
        }
      >
        <Icon className="size-5" aria-hidden />
        {variant === "sidebar" && <span>New</span>}
      </button>
      {open && (
        <ul
          role="menu"
          aria-label="Quick add"
          className={`absolute z-50 w-56 rounded-2xl border bg-card p-1 shadow-overlay ${variant === "fab" ? "right-0 bottom-16" : "left-0 top-12"}`}
        >
          {items.map((item) => (
            <li key={item.href} role="none">
              <Link role="menuitem" href={item.href} className="flex h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-muted">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
