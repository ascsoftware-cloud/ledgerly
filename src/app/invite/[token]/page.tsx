import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MailCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { acceptInvite } from "@/features/team/actions";
import { AcceptInviteButton } from "@/features/team/components/team-tools";
import { loadInvitePreview } from "@/features/team/queries";
import { ROLE_HELP, ROLE_LABEL } from "@/features/team/schema";
import { createServerClient } from "@/lib/supabase/server";

// An invitation link is private: never indexed.
export const metadata: Metadata = { title: "You're invited", robots: { index: false, follow: false } };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto w-full max-w-md space-y-6 px-4 py-12">
      <Suspense fallback={<PageSkeleton variant="detail" />}>
        <Invite params={params} />
      </Suspense>
    </main>
  );
}

async function Invite({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  const res = await loadInvitePreview(token);
  if (res.kind === "busy") return <p role="alert">Too many requests from your connection. Try again in a few minutes.</p>;
  if (res.kind === "missing") notFound();
  const { preview } = res;

  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getClaims();
  const signedIn = Boolean(auth?.claims?.sub);
  const invitePath = `/invite/${token}`;

  return (
    <section aria-label="Invitation" className="space-y-5 rounded-2xl border bg-card p-6 text-center shadow-card">
      <MailCheck className="mx-auto size-12 text-primary" aria-hidden />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Join {preview.business}</h1>
        <p className="text-muted-foreground">
          You have been invited as <strong className="text-foreground">{ROLE_LABEL[preview.role].toLowerCase()}</strong>.
        </p>
        <p className="text-sm text-muted-foreground">{ROLE_HELP[preview.role]}</p>
      </div>

      {preview.state === "accepted" && (
        <p role="status" className="rounded-xl bg-muted p-3 text-sm">
          This invitation has already been used. If that was you, sign in to open the business.
        </p>
      )}
      {preview.state === "expired" && (
        <p role="status" className="rounded-xl bg-muted p-3 text-sm">
          This invitation has expired. Ask {preview.business} to send you a new one.
        </p>
      )}

      {preview.state === "open" &&
        (signedIn ? (
          <>
            <AcceptInviteButton onAccept={acceptInvite.bind(null, token)} invitePath={invitePath} />
            <p className="text-xs text-muted-foreground">It must be the email address the invitation went to ({preview.email_hint}).</p>
          </>
        ) : (
          <>
            <Link href={`/login?next=${encodeURIComponent(invitePath)}`} className={buttonVariants({ size: "touch" }) + " w-full"}>
              Sign in to accept
            </Link>
            <p className="text-xs text-muted-foreground">
              Sign in with the email address the invitation went to ({preview.email_hint}), using Google or a one-time code. There is no password.
            </p>
          </>
        ))}
      {(preview.state !== "open" || !signedIn) && preview.state !== "open" && (
        <Link href="/login" className={buttonVariants({ variant: "outline", size: "touch" })}>
          Sign in
        </Link>
      )}
    </section>
  );
}
