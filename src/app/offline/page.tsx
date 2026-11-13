import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/** Shown by the service worker when a page isn't saved and there is no connection. Nothing here is personal. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <WifiOff className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
      <p className="text-muted-foreground">This page hasn&apos;t been saved on your phone yet. Pages you have opened before still work. Connect to the internet and try again.</p>
      <Link href="/" className="inline-flex h-12 items-center rounded-xl border px-5 font-medium">
        Try again
      </Link>
    </main>
  );
}
