import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Calculator, CheckCircle2, Settings } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { FailedJobs } from "@/features/integrations/components/integrations-settings";
import { accountingOverview } from "@/features/integrations/queries";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Accounting", robots: { index: false } };

const APP = { xero: "Xero", sage_za: "Sage" } as const;
const card = "rounded-2xl border bg-card p-5 shadow-card";

export default function AccountingPage({ params }: PageProps<"/[ws]/accounting">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Accounting params={params} />
    </Suspense>
  );
}

async function Accounting({ params }: { params: PageProps<"/[ws]/accounting">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const manager = ctx.role === "owner" || ctx.role === "admin";
  const o = await accountingOverview(ctx);

  if (!o.apps.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Accounting</h1>
        <EmptyState
          icon={Calculator}
          title="No accounting app connected"
          body={
            manager
              ? "Connect Xero or Sage and every invoice, credit note and payment is copied there as it happens."
              : "Ask an owner or admin to connect Xero or Sage."
          }
          action={
            manager
              ? { label: "Connect Xero or Sage", href: `/${ws}/settings/integrations` }
              : { label: "Back to home", href: `/${ws}` }
          }
        />
      </div>
    );
  }

  const names = Object.fromEntries(
    o.apps.map((a) => [a.id, APP[a.provider as "xero" | "sage_za"]]),
  );
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounting</h1>
          <p className="text-sm text-muted-foreground">
            Ledgerly sends a copy of each invoice, credit note and payment. Ledgerly stays in
            charge.
          </p>
        </div>
        {manager && (
          <Link
            href={`/${ws}/settings/integrations`}
            className={buttonVariants({ variant: "outline", size: "touch" })}
          >
            <Settings className="size-4" aria-hidden /> Accounts and VAT
          </Link>
        )}
      </header>

      {o.apps.map((a) => (
        <section key={a.id} aria-label={APP[a.provider as "xero" | "sage_za"]} className={card}>
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {a.status === "active" ? (
              <CheckCircle2 className="size-5 text-success" aria-hidden />
            ) : (
              <AlertTriangle className="size-5 text-destructive" aria-hidden />
            )}
            {APP[a.provider as "xero" | "sage_za"]}
            {a.external_name && (
              <span className="font-normal text-muted-foreground">· {a.external_name}</span>
            )}
            {a.status !== "active" && (
              <span className="text-sm font-normal text-destructive">needs reconnecting</span>
            )}
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              ["Documents sent this month", a.sentThisMonth],
              ["Payments sent this month", a.paymentsThisMonth],
              ["Waiting to send", a.waiting],
              ["Totals that differ", a.mismatches],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl bg-muted/50 p-3">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd
                  className={`text-2xl font-semibold tabular-nums ${label === "Totals that differ" && Number(value) > 0 ? "text-destructive" : ""}`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <FailedJobs slug={ws} jobs={o.failed} names={names} canRetry={manager} />

      <section aria-labelledby="recent-heading" className={card}>
        <h2 id="recent-heading" className="font-semibold">
          Recently sent
        </h2>
        {o.recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing yet. Invoices you send from now on appear here.
          </p>
        ) : (
          <ul className="mt-2 divide-y text-sm">
            {o.recent.map((r) => (
              <li
                key={`${r.documentId}-${r.app}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <Link href={`/${ws}/money/${r.documentId}`} className="hover:text-primary">
                  <span className="font-medium">{r.number}</span>{" "}
                  <span className="text-muted-foreground">· {r.client}</span>
                </Link>
                <span className="flex items-center gap-3">
                  <span className={r.mismatch ? "text-destructive" : "text-muted-foreground"}>
                    {r.mismatch
                      ? `In ${r.app}, total differs`
                      : `In ${r.app}${r.externalNumber ? ` as ${r.externalNumber}` : ""}`}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(r.kind === "credit_note" ? -r.totalCents : r.totalCents)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
