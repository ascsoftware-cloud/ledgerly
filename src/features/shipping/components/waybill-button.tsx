"use client";

import { useTransition } from "react";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { waybillLink } from "../actions";

export function WaybillButton({ slug, shipmentId }: { slug: string; shipmentId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const url = await waybillLink(slug, shipmentId);
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          else toast.error("The waybill isn't ready yet. Try again in a minute.");
        })
      }
    >
      <FileDown className="size-3.5" aria-hidden /> Waybill
    </Button>
  );
}
