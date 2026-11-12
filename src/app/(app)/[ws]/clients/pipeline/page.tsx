import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ClientsTabs } from "@/features/clients/components/clients-tabs";
import { moveDeal } from "@/features/pipeline/actions";
import { AddDealForm } from "@/features/pipeline/components/add-deal-form";
import { contactOptions, getBoard } from "@/features/pipeline/queries";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Pipeline", robots: { index: false } };

export default function PipelinePage({ params }: PageProps<"/[ws]/clients/pipeline">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Pipeline params={params} />
    </Suspense>
  );
}

async function Pipeline({ params }: { params: PageProps<"/[ws]/clients/pipeline">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const [stages, contacts] = await Promise.all([getBoard(ctx), contactOptions(ctx)]);
  const canWrite = ctx.role !== "accountant";
  const move = moveDeal.bind(null, ws);
  const openTotal = stages.filter((s) => s.outcome === "open").reduce((sum, s) => sum + s.totalCents, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <ClientsTabs slug={ws} current="pipeline" />
      </header>
      <p className="text-muted-foreground">
        {formatMoney(openTotal)} in open deals.
      </p>

      {canWrite && <AddDealForm slug={ws} stages={stages} contacts={contacts} />}

      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <ol className="flex min-w-max gap-4" aria-label="Pipeline stages">
          {stages.map((stage, i) => (
            <li key={stage.id} className="w-72 shrink-0">
              <section aria-label={stage.name} className="flex h-full flex-col rounded-2xl bg-muted p-3">
                <header className="mb-3 flex items-baseline justify-between px-1">
                  <h2 className="font-semibold">
                    {stage.name} <span className="text-sm font-normal text-muted-foreground">{stage.deals.length}</span>
                  </h2>
                  <span className="text-sm text-muted-foreground tabular-nums">{formatMoney(stage.totalCents)}</span>
                </header>
                {stage.deals.length === 0 ? (
                  <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                    No deals here
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {stage.deals.map((d) => {
                      const prev = stages[i - 1];
                      const next = stages[i + 1];
                      return (
                        <li key={d.id} className="rounded-xl border bg-card p-3 shadow-card">
                          <p className="font-medium">{d.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {d.contacts ? (
                              <Link href={`/${ws}/clients/${d.contacts.id}`} className="hover:text-primary">
                                {d.contacts.name}
                              </Link>
                            ) : (
                              "No client yet"
                            )}
                            {" · "}
                            <span className="tabular-nums">{formatMoney(d.value_cents)}</span>
                          </p>
                          {canWrite && (
                            <div className="mt-2 flex justify-between">
                              {prev ? (
                                <form action={move}>
                                  <input type="hidden" name="dealId" value={d.id} />
                                  <input type="hidden" name="stageId" value={prev.id} />
                                  <button
                                    type="submit"
                                    aria-label={`Move ${d.title} to ${prev.name}`}
                                    className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                                  >
                                    <ChevronLeft className="size-5" aria-hidden />
                                  </button>
                                </form>
                              ) : (
                                <span />
                              )}
                              {next && (
                                <form action={move}>
                                  <input type="hidden" name="dealId" value={d.id} />
                                  <input type="hidden" name="stageId" value={next.id} />
                                  <button
                                    type="submit"
                                    aria-label={`Move ${d.title} to ${next.name}`}
                                    className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                                  >
                                    <ChevronRight className="size-5" aria-hidden />
                                  </button>
                                </form>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
