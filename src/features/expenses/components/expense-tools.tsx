"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, FileImage } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { receiptLink, setExpenseArchived, stopRecurring } from "../actions";

/** Opens the private receipt through a link that works for 60 seconds. */
export function ViewReceipt({ slug, path }: { slug: string; path: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const url = await receiptLink(slug, path);
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          else toast.error("Couldn't open the receipt.");
        })
      }
    >
      <FileImage className="size-5" aria-hidden /> View receipt
    </Button>
  );
}

/** Archive, then land on the list, which offers the 6-second undo (its own action, on its own page). */
export function ArchiveExpense({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="touch"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await setExpenseArchived(slug, id, true);
        setBusy(false);
        if (!r.ok) return toast.error("Couldn't archive that expense.");
        router.push(`/${slug}/money/expenses?archived=${id}`);
      }}
    >
      <Archive className="size-5" aria-hidden /> Archive
    </Button>
  );
}

/** On the list right after an archive: one toast, six seconds to undo. */
export function UndoExpenseArchive({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (shown.current === id) return;
    shown.current = id;
    router.replace(`/${slug}/money/expenses`, { scroll: false });
    toast("Expense archived", {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await setExpenseArchived(slug, id, false);
          if (undo.ok) {
            toast.success("Expense is back");
            router.refresh();
          } else toast.error("Couldn't undo. Try again.");
        },
      },
    });
  }, [id, router, slug]);
  return null;
}

/** Stop a repeating cost (expenses already added stay). */
export function StopRecurring({ slug, id, label }: { slug: string; id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="touch"
      disabled={pending}
      aria-label={`Stop ${label}`}
      onClick={() =>
        start(async () => {
          const r = await stopRecurring(slug, id);
          if (r.ok) {
            toast.success(`${label} stopped`);
            router.refresh();
          } else toast.error("Couldn't stop it. Try again.");
        })
      }
    >
      Stop
    </Button>
  );
}
