"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setArchived } from "../actions";

/**
 * Archives straight away and returns to the list, which offers six seconds to undo
 * (the undo lives on the list page: a server action must belong to the page that calls it).
 */
export function ArchiveButton({ slug, contactId }: { slug: string; contactId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function archive() {
    start(async () => {
      const res = await setArchived(slug, contactId, true);
      if (!res.ok) {
        toast.error("Couldn't archive this client.");
        return;
      }
      router.push(`/${slug}/clients?archived=${contactId}`);
    });
  }

  return (
    <Button variant="outline" size="touch" onClick={archive} disabled={pending}>
      <Archive className="size-5" aria-hidden />
      Archive
    </Button>
  );
}
