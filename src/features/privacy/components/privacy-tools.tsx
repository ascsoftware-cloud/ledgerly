"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelAccountDeletion, cancelWorkspaceDeletion, requestAccountDeletion, requestWorkspaceDeletion } from "../actions";

export function DeleteBusinessForm({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Delete this business"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await requestWorkspaceDeletion(slug, typed);
          if (!r.ok) return void setError(r.message);
          toast.success("Deletion scheduled. You have 7 days to change your mind.");
          router.refresh();
        });
      }}
    >
      <label className="block space-y-1 text-sm font-medium">
        Type <span className="font-semibold">{name}</span> to confirm
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-12 text-base" />
      </label>
      <Button type="submit" variant="destructive" size="touch" disabled={pending || !typed.trim()}>
        {pending ? "Scheduling…" : "Delete this business"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

export function DeleteAccountForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Delete my account"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await requestAccountDeletion(slug, typed);
          if (!r.ok) return void setError(r.message);
          toast.success("Account deletion scheduled. You have 7 days to change your mind.");
          router.refresh();
        });
      }}
    >
      <label className="block space-y-1 text-sm font-medium">
        Type DELETE to confirm
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-12 text-base" />
      </label>
      <Button type="submit" variant="destructive" size="touch" disabled={pending || !typed.trim()}>
        {pending ? "Scheduling…" : "Delete my account"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/** Undo for a scheduled deletion, shown in the notice and on the Your data page. */
export function CancelDeletionButton({ slug, which }: { slug: string; which: "business" | "account" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = which === "business" ? await cancelWorkspaceDeletion(slug) : await cancelAccountDeletion(slug);
          if (!r.ok) return void toast.error(r.message);
          toast.success("Deletion cancelled");
          router.refresh();
        })
      }
    >
      {pending ? "Cancelling…" : which === "business" ? "Keep this business" : "Keep my account"}
    </Button>
  );
}
