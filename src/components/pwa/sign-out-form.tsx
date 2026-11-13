"use client";

import { LogOut } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { signOut } from "@/features/auth/actions";
import { clearOfflineCopies } from "./pwa-tools";

/** Signs out, and first forgets the pages saved for offline reading on this device. */
export function SignOutForm() {
  return (
    <form
      action={async () => {
        await clearOfflineCopies();
        await signOut();
      }}
      className="mt-4"
    >
      <button type="submit" className={buttonVariants({ variant: "outline", size: "touch" })}>
        <LogOut className="size-5" aria-hidden />
        Sign out
      </button>
    </form>
  );
}
