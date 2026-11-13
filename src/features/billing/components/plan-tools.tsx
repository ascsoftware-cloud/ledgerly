"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addBusiness, cancelPlan, startUpgrade } from "../actions";

/** Hands the owner to PayFast's hosted page to pay. No card details touch Ledgerly. */
export function UpgradeButton({ slug, price }: { slug: string; price: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        size="touch"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startUpgrade(slug);
            if (!r.ok) return void setError(r.message);
            const form = document.createElement("form");
            form.method = "POST";
            form.action = r.action;
            for (const [name, value] of r.fields) {
              const input = document.createElement("input");
              input.type = "hidden";
              input.name = name;
              input.value = value;
              form.appendChild(input);
            }
            document.body.appendChild(form);
            form.submit();
          })
        }
      >
        {pending ? "Opening PayFast…" : `Upgrade to Pro for ${price} a month`}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function CancelPlanButton({ slug, endsOn }: { slug: string; endsOn: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="touch" onClick={() => setConfirming(true)}>
        Cancel Pro
      </Button>
    );
  }
  return (
    <div className="space-y-2" role="group" aria-label="Cancel Pro?">
      <p className="text-sm">
        Pro stays on until {endsOn}. After that this business goes back to Free. Nothing is deleted or hidden, and you can upgrade again any time.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="touch"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await cancelPlan(slug);
              if (!r.ok) return void setError(r.message);
              toast.success("Pro will end when your paid month does.");
              router.refresh();
            })
          }
        >
          {pending ? "Cancelling…" : "Yes, cancel Pro"}
        </Button>
        <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(false)}>
          Keep Pro
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function AddBusinessForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Add another business"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addBusiness(slug, name);
          if (!r.ok) return void setError(r.message);
          toast.success("Business added");
          router.push(`/${r.slug}`);
        });
      }}
    >
      <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">
        Business name
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-12 text-base" />
      </label>
      <Button type="submit" size="touch" disabled={pending || !name.trim()}>
        {pending ? "Adding…" : "Add business"}
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
