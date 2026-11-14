"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelInvite, changeRole, inviteMember, leaveWorkspace, removeMember, resendInvite, type FormResult } from "../actions";
import { INVITE_ROLES, ROLE_HELP, ROLE_LABEL } from "../schema";

export function InviteForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>("staff");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, form) => {
    const r = await inviteMember(slug, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      setEmail("");
      setRequestId(crypto.randomUUID());
      router.refresh();
    }
    return r;
  }, { status: "idle" });
  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";
  return (
    <form action={action} noValidate aria-label="Invite someone" className="grid gap-4 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-[2fr_1fr]">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="space-y-1 text-sm font-medium">
        Their email
        <Input name="email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.co.za" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Role
        <select name="role" value={role} onChange={(e) => setRole(e.target.value as (typeof INVITE_ROLES)[number])} className={field}>
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-muted-foreground sm:col-span-2">{ROLE_HELP[role]}</p>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Sending…" : "Send invitation"}
        </Button>
      </div>
    </form>
  );
}

type MemberView = { userId: string; role: "owner" | "admin" | "staff" | "accountant"; name: string | null; email: string };

/** One person: change their role or remove them. The database has the last word (the last owner stays). */
export function MemberControls({ slug, member, viewerId, viewerRole }: { slug: string; member: MemberView; viewerId: string; viewerRole: "owner" | "admin" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const label = member.name || member.email;
  const isMe = member.userId === viewerId;
  // Only an owner can change or remove an owner, or make one.
  const locked = member.role === "owner" && viewerRole !== "owner";
  const roles = viewerRole === "owner" ? (["owner", "admin", "staff", "accountant"] as const) : (["admin", "staff", "accountant"] as const);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message ?? "That didn't work.");
      toast.success(done);
      setConfirming(false);
      router.refresh();
    });

  if (isMe) {
    return confirming ? (
      <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Leave this business?">
        <Button
          type="button"
          variant="destructive"
          size="touch"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await leaveWorkspace(slug);
              if (r && !r.ok) toast.error(r.message);
            })
          }
        >
          Yes, leave
        </Button>
        <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(false)}>
          Stay
        </Button>
      </span>
    ) : (
      <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(true)}>
        Leave this business
      </Button>
    );
  }
  if (locked) return <span className="text-sm text-muted-foreground">{ROLE_LABEL[member.role]}</span>;

  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        aria-label={`Role for ${label}`}
        value={member.role}
        disabled={pending}
        onChange={(e) => run(() => changeRole(slug, member.userId, e.target.value), `${label} is now ${ROLE_LABEL[e.target.value as keyof typeof ROLE_LABEL].toLowerCase()}`)}
        className="h-11 rounded-xl border bg-background px-3 text-sm"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      {confirming ? (
        <span className="flex gap-1" role="group" aria-label={`Remove ${label}?`}>
          <Button type="button" variant="destructive" size="touch" disabled={pending} onClick={() => run(() => removeMember(slug, member.userId), `${label} removed`)}>
            Yes, remove {label}
          </Button>
          <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <Button type="button" variant="ghost" size="touch" aria-label={`Remove ${label}`} onClick={() => setConfirming(true)}>
          Remove
        </Button>
      )}
    </span>
  );
}

export function InviteControls({ slug, id, email, role }: { slug: string; id: string; email: string; role: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span className="flex gap-1">
      <Button
        type="button"
        variant="outline"
        size="touch"
        disabled={pending}
        aria-label={`Send ${email} a new link`}
        onClick={() =>
          start(async () => {
            const r = await resendInvite(slug, email, role);
            if (!r.ok) return void toast.error(r.message ?? "Couldn't send it again.");
            toast.success(`New invitation sent to ${email}`);
            router.refresh();
          })
        }
      >
        Send again
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="touch"
        disabled={pending}
        aria-label={`Cancel the invitation for ${email}`}
        onClick={() =>
          start(async () => {
            const r = await cancelInvite(slug, id);
            if (!r.ok) return void toast.error("Couldn't cancel that.");
            toast.success("Invitation cancelled");
            router.refresh();
          })
        }
      >
        Cancel
      </Button>
    </span>
  );
}

export function AcceptInviteButton({
  onAccept,
  invitePath,
}: {
  onAccept: () => Promise<{ status: "error"; message: string } | void>;
  invitePath: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEmailMismatch = error?.toLowerCase().includes("different email") ?? false;

  return (
    <div className="space-y-3">
      <Button
        type="button"
        size="touch"
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await onAccept();
            if (r && r.status === "error") setError(r.message);
          })
        }
      >
        {pending ? "Joining…" : "Accept the invitation"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {isEmailMismatch && (
        <Link
          href={`/login?next=${encodeURIComponent(invitePath)}`}
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create account
        </Link>
      )}
    </div>
  );
}
