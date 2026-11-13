import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { CancelDeletionButton } from "./privacy-tools";
import type { DeletionState } from "../queries";

/** At the top of the app while this business or this person's account is waiting out its 7 days. */
export function DeletionBanner({ slug, state, isOwner }: { slug: string; state: DeletionState; isOwner: boolean }) {
  if (!state.workspaceOn && !state.accountOn) return null;
  const day = (iso: string) => formatDate(iso.slice(0, 10));
  return (
    <div className="mb-4 space-y-2">
      {state.workspaceOn && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p>
            This business will be deleted on {day(state.workspaceOn)}.{" "}
            <Link href={`/${slug}/settings/data`} className="underline underline-offset-4">
              Your data
            </Link>
          </p>
          {isOwner && !state.accountOn && <CancelDeletionButton slug={slug} which="business" />}
        </div>
      )}
      {state.accountOn && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p>Your account will be deleted on {day(state.accountOn)}.</p>
          <CancelDeletionButton slug={slug} which="account" />
        </div>
      )}
    </div>
  );
}
