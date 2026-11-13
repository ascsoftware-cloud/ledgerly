import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex h-11 items-center" aria-label="Ledgerly by ASC, home">
            <Wordmark />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            <span className="hidden sm:block">
              <Link href="/pricing" className={buttonVariants({ variant: "ghost", size: "touch", className: "px-3" })}>
                Pricing
              </Link>
            </span>
            <Link
              href="/login"
              prefetch={false}
              className={buttonVariants({ variant: "ghost", size: "touch", className: "px-3" })}
            >
              Sign in
            </Link>
            <Link href="/start" className={buttonVariants({ size: "touch" })}>
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Ledgerly by ASC. Made in South Africa.</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-2">
            {[
              ["Pricing", "/pricing"],
              ["Privacy", "/privacy"],
              ["Terms", "/terms"],
              ["POPIA", "/popia"],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href!}
                prefetch={false}
                className="flex h-11 items-center px-2 underline-offset-4 hover:text-foreground hover:underline"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
