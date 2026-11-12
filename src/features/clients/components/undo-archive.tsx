"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setArchived } from "../actions";

/** Shown on the client list right after an archive: one toast, six seconds to undo. */
export function UndoArchive({ slug, contactId, name }: { slug: string; contactId: string; name: string }) {
  const router = useRouter();
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (shown.current === contactId) return;
    shown.current = contactId;
    router.replace(`/${slug}/clients`, { scroll: false });
    toast(`${name} archived`, {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await setArchived(slug, contactId, false);
          if (undo.ok) {
            toast.success(`${name} is back`);
            router.refresh();
          } else toast.error("Couldn't undo. Try again.");
        },
      },
    });
  }, [contactId, name, router, slug]);

  return null;
}
