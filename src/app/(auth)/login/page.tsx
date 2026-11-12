import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4">
      <header className="flex h-16 items-center">
        <Link href="/" className="flex h-11 items-center text-lg font-semibold tracking-tight">
          Ledgerly
        </Link>
      </header>
      <div className="flex flex-1 flex-col justify-center pb-16">
        <Suspense fallback={<PageSkeleton variant="detail" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
