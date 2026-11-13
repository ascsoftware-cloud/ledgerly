import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, History } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { InviteControls, InviteForm, MemberControls } from "@/features/team/components/team-tools";
import { listInvites, listMembers } from "@/features/team/queries";
import { ROLE_LABEL } from "@/features/team/schema";
import { formatDate, todaySAST } from "@/lib/dates";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Team", robots: { index: false } };

export default function TeamPage({ params }: PageProps<"/[ws]/settings/team">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Team params={params} />
    </Suspense>
  );
}

async function Team({ params }: { params: PageProps<"/[ws]/settings/team">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  // Staff and accountants have no team page (spec section 3).
  const viewerRole = ctx.role;
  if (viewerRole !== "owner" && viewerRole !== "admin") notFound();
  const [members, invites] = await Promise.all([listMembers(ctx), listInvites(ctx)]);
  const today = todaySAST();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/more`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> More
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <Link href={`/${ws}/settings/team/activity`} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary">
          <History className="size-4" aria-hidden /> Activity log
        </Link>
      </header>

      <section aria-labelledby="members-heading" className="rounded-2xl border bg-card shadow-card">
        <h2 id="members-heading" className="px-4 pt-4 font-semibold">
          People with access
        </h2>
        <ul className="divide-y" aria-label="People with access">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {m.name || m.email}
                  {m.userId === ctx.user.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {m.name ? `${m.email} · ` : ""}
                  {ROLE_LABEL[m.role]} · joined {formatDate(m.joinedAt.slice(0, 10))}
                </span>
              </span>
              <MemberControls slug={ws} member={m} viewerId={ctx.user.id} viewerRole={viewerRole} />
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section aria-labelledby="invites-heading" className="rounded-2xl border bg-card shadow-card">
          <h2 id="invites-heading" className="px-4 pt-4 font-semibold">
            Waiting to accept
          </h2>
          <ul className="divide-y" aria-label="Open invitations">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.email}</span>
                  <span className="block text-sm text-muted-foreground">
                    {ROLE_LABEL[i.role]} · {i.expires_at.slice(0, 10) < today ? "expired" : `link works until ${formatDate(i.expires_at.slice(0, 10))}`}
                  </span>
                </span>
                <InviteControls slug={ws} id={i.id} email={i.email} role={i.role} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="invite-heading" className="space-y-3">
        <h2 id="invite-heading" className="font-semibold">
          Invite someone
        </h2>
        <InviteForm slug={ws} />
        <p className="text-sm text-muted-foreground">They sign in with Google or an email code, the same as you. There are no passwords.</p>
      </section>
    </div>
  );
}
