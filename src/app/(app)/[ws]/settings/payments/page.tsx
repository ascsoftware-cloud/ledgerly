import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { PaymentSettings } from "@/features/payments/components/payment-settings";
import { RemindersSwitch } from "@/features/payments/components/reminders-switch";
import { getPaymentSettings } from "@/features/payments/queries";
import { siteUrl } from "@/lib/site-url";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Getting paid", robots: { index: false } };

export default function PaymentsSettingsPage({ params }: PageProps<"/[ws]/settings/payments">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: { params: PageProps<"/[ws]/settings/payments">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role !== "owner" && ctx.role !== "admin") notFound();
  const s = await getPaymentSettings(ctx);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/more`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> More
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Getting paid</h1>
        <p className="text-muted-foreground">Choose how clients can pay your invoices. Set up any or all.</p>
      </div>
      <RemindersSwitch slug={ws} initial={s.autoReminders} />
      <PaymentSettings slug={ws} yoco={s.yoco} payfast={s.payfast} stitch={s.stitch} bank={s.bank} siteUrl={siteUrl()} />
    </div>
  );
}
