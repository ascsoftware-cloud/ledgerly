import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent text-primary">
        <Compass className="size-7" aria-hidden />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">We can&apos;t find that page</h1>
      <p className="max-w-sm text-muted-foreground">
        The link may be old, or the page may have moved.
      </p>
      <Link href="/" className={buttonVariants({ size: "touch" })}>
        Back to home
      </Link>
    </main>
  );
}
