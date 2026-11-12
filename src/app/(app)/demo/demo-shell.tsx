"use client";

import { FileText } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { PageSkeleton } from "@/components/states/page-skeleton";

const NAV: NavItem[] = [
  { key: "home", label: "Home", href: "/demo", icon: "home" },
  { key: "money", label: "Money", href: "/demo/money", icon: "wallet" },
  { key: "clients", label: "Clients", href: "/demo/clients", icon: "users" },
  { key: "work", label: "Work", href: "/demo/work", icon: "briefcase" },
  { key: "more", label: "More", href: "/demo/more", icon: "menu" },
];

export function DemoShell() {
  return (
    <AppShell nav={NAV}>
      <div className="space-y-8">
        <h1 className="text-2xl font-semibold tracking-tight">Shell demo</h1>
        <section className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Empty</p>
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            body="Send your first invoice and get paid by card, EFT or cash."
            action={{ label: "Create your first invoice", href: "/demo" }}
          />
        </section>
        <section className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Error</p>
          <ErrorState onRetry={() => window.location.reload()} />
        </section>
        <section className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Loading</p>
          <PageSkeleton variant="list" />
        </section>
      </div>
    </AppShell>
  );
}
