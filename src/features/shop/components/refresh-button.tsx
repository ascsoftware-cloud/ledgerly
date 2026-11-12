"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { refreshShop } from "@/features/integrations/actions";

export function RefreshButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="touch"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await refreshShop(slug);
          if (r.ok) toast.success("Refreshing from Shopify. Give it a minute.");
          else toast.error("Couldn't start a refresh.");
          router.refresh();
        })
      }
    >
      <RefreshCw className="size-4" aria-hidden /> Refresh
    </Button>
  );
}
