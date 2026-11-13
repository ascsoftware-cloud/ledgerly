import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { CancelDeletionButton, DeleteAccountForm, DeleteBusinessForm } from "@/features/privacy/components/privacy-tools";
import { getDeletionState } from "@/features/privacy/queries";
import { formatDate } from "@/lib/dates";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Your data", robots: { index: false } };

export default function DataPage({ params }: PageProps<"/[ws]/settings/data">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Data params={params} />
    </Suspense>
  );
}

async function Data({ params }: { params: PageProps<"/[ws]/settings/data">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const state = await getDeletionState(ctx);
  const isOwner = ctx.role === "owner";
  const day = (iso: string) => formatDate(iso.slice(0, 10));
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/more`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> More
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Your data</h1>
      <p className="text-sm text-muted-foreground">Your information is yours. You can take a copy of everything, or delete it.</p>

      {isOwner && (
        <section aria-labelledby="export-heading" className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
          <h2 id="export-heading" className="font-semibold">
            Download everything
          </h2>
          <p className="text-sm text-muted-foreground">
            A ZIP with one file for each kind of record (clients, invoices, expenses and more) and the files you uploaded. It can take a moment.
          </p>
          <a href={`/${ws}/settings/data/export`} download className={buttonVariants({ variant: "outline", size: "touch" })}>
            <Download className="size-5" aria-hidden /> Download my business data
          </a>
        </section>
      )}

      {isOwner && (
        <section aria-labelledby="del-biz-heading" className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
          <h2 id="del-biz-heading" className="font-semibold">
            Delete this business
          </h2>
          {state.workspaceOn ? (
            <div className="space-y-3">
              <p role="status" className="text-sm">
                This business will be deleted on {day(state.workspaceOn)}. Until then you can change your mind.
              </p>
              <CancelDeletionButton slug={ws} which="business" />
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Everything in {ctx.workspace.name} (clients, invoices, files, team) is deleted 7 days after you ask, and cannot be recovered after that. Download a copy first. If this business is on Pro, it is cancelled so you are not charged again.
              </p>
              <DeleteBusinessForm slug={ws} name={ctx.workspace.name} />
            </>
          )}
        </section>
      )}

      <section aria-labelledby="del-me-heading" className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
        <h2 id="del-me-heading" className="font-semibold">
          Delete my account
        </h2>
        {state.accountOn ? (
          <div className="space-y-3">
            <p role="status" className="text-sm">
              Your account will be deleted on {day(state.accountOn)}. Until then you can change your mind.
            </p>
            <CancelDeletionButton slug={ws} which="account" />
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Deletes your sign-in and the businesses that only you belong to, 7 days after you ask. If you own a business with other people in it, remove them first or delete that business. You are removed from businesses that belong to others.
            </p>
            <DeleteAccountForm slug={ws} />
          </>
        )}
      </section>
    </div>
  );
}
