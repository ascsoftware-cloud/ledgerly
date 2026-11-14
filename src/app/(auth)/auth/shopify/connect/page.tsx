import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { z } from "zod";
import { Wordmark } from "@/components/brand/logo";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { createServerClient } from "@/lib/supabase/server";
import { isShopDomain } from "@/server/integrations/shopify";

export const metadata: Metadata = { title: "Connect your Shopify store", robots: { index: false } };

export default function ConnectShopifyPage({ searchParams }: PageProps<"/auth/shopify/connect">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4">
      <header className="flex h-16 items-center">
        <Link href="/" className="flex h-11 items-center" aria-label="Ledgerly by ASC, home">
          <Wordmark />
        </Link>
      </header>
      <div className="flex flex-1 flex-col justify-center pb-16">
        <Suspense fallback={<PageSkeleton variant="detail" />}>
          <Connect searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

const rows = z.array(z.object({ slug: z.string(), name: z.string() }));

async function Connect({ searchParams }: { searchParams: PageProps<"/auth/shopify/connect">["searchParams"] }) {
  await connection();
  const q = await searchParams;
  const shop = typeof q.shop === "string" ? q.shop.toLowerCase() : "";
  if (!isShopDomain(shop)) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">That store address doesn&apos;t look right</h1>
        <p className="text-muted-foreground">Start again from Shopify, or connect your store from More › Connect apps inside Ledgerly.</p>
      </div>
    );
  }

  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) redirect(`/login?next=${encodeURIComponent(`/auth/shopify/connect?${new URLSearchParams({ shop })}`)}`);

  const { data } = await supabase
    .from("workspaces")
    .select("slug, name, memberships!inner(role)")
    .eq("memberships.user_id", uid)
    .in("memberships.role", ["owner", "admin"])
    .is("deleted_at", null)
    .order("created_at");
  const businesses = rows.catch([]).parse(data ?? []);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Connect {shop} to Ledgerly</h1>
      <p className="text-muted-foreground">Ledgerly will show this store&apos;s products, stock and orders. It only reads: nothing in Shopify is changed. Which business is it for?</p>
      {businesses.length === 0 ? (
        <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
          <p>You are not an owner or admin of a Ledgerly business yet, so there is nothing to connect it to.</p>
          <Link href="/start" className={buttonVariants({ size: "touch" })}>
            Start a business
          </Link>
        </div>
      ) : (
        <ul aria-label="Your businesses" className="divide-y rounded-2xl border bg-card shadow-card">
          {businesses.map((b) => (
            <li key={b.slug}>
              <Link
                href={`/api/oauth/shopify/start?${new URLSearchParams({ ws: b.slug, shop })}`}
                prefetch={false}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 font-medium hover:text-primary"
              >
                {b.name}
                <span className="text-sm font-normal text-muted-foreground">Connect</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
