"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setAiEnabled } from "../actions";

/** The business-wide AI switch. Off until an owner or admin turns it on. */
export function AiSwitch({ slug, enabled: initial, disabled }: { slug: string; enabled: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <label className="flex min-h-11 items-start gap-3 text-sm font-medium">
      <input
        type="checkbox"
        checked={enabled}
        disabled={pending || disabled}
        onChange={(e) => {
          const next = e.target.checked;
          setEnabled(next);
          start(async () => {
            const r = await setAiEnabled(slug, next);
            if (!r.ok) {
              setEnabled(!next);
              return void toast.error("Couldn't change that.");
            }
            toast.success(next ? "Miko switched on" : "Miko switched off");
            router.refresh();
          });
        }}
        className="mt-0.5 size-5 accent-primary"
      />
      <span>Use Miko, the AI helper, in this business</span>
    </label>
  );
}
