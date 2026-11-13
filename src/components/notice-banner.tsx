"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const KEY = "ledgerly-notice-v1";
const EVENT = "ledgerly:notice";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Only used when storage is blocked, so the button still works for this visit.
let memoryAck = false;
function acknowledged(): boolean {
  try {
    return memoryAck || localStorage.getItem(KEY) === "1";
  } catch {
    return memoryAck;
  }
}

/**
 * A plain notice, not a consent choice: Ledgerly sets only the cookies and storage it needs to work, so there is
 * nothing to accept or refuse. It sits at the top of the page (never over content) until it is dismissed.
 */
export function NoticeBanner() {
  const seen = useSyncExternalStore(subscribe, acknowledged, () => true);
  if (seen) return null;
  return (
    <div role="region" aria-label="Cookies and privacy" className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 text-sm print:hidden">
      <p className="min-w-0 flex-1">
        Ledgerly only uses the cookies and storage it needs to work: your sign-in, your theme and saved pages. No ads, no tracking.{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy policy
        </Link>
      </p>
      <Button
        type="button"
        size="touch"
        variant="outline"
        onClick={() => {
          memoryAck = true;
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            // Storage blocked: the notice stays dismissed for this visit only.
          }
          window.dispatchEvent(new Event(EVENT));
        }}
      >
        Got it
      </Button>
    </div>
  );
}
