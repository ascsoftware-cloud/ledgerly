import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatPrice, PLANS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Ledgerly is free to start. Pro is ${formatPrice(PLANS.pro.priceCents)} a month for the whole business, with unlimited people.`,
  alternates: { canonical: "/pricing" },
};

const ROWS: { label: string; free: string | boolean; pro: string | boolean }[] = [
  { label: "Clients, invoices, quotes, expenses, tasks and bookings", free: true, pro: true },
  { label: "People on your team", free: "Unlimited", pro: "Unlimited" },
  { label: "Invoices and quotes sent", free: "10 a month", pro: "Unlimited" },
  { label: "File storage", free: "200 MB", pro: "10 GB" },
  { label: "AI helper requests", free: "20 a month", pro: "300 a month" },
  { label: "Automations that chase invoices for you", free: false, pro: true },
  { label: "Customer portal", free: false, pro: true },
  { label: "No “Sent with Ledgerly” footer", free: false, pro: true },
  { label: "More than one business", free: false, pro: true },
];

const FAQ = [
  ["Can I try Pro first?", "Everything you need to run a small business is on Free. Upgrade when you outgrow it, and cancel any time."],
  ["What happens if I cancel?", "Pro stays on until the month you paid for ends. Then your business goes back to Free. Nothing is deleted or hidden, and you can still view and download everything."],
  ["How do I pay?", "By card through PayFast, once a month. Ledgerly never sees your card details."],
  ["Is the price per person?", "No. It is one price for the whole business, however many people you add."],
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="mx-auto size-5 text-primary" aria-label="Included" />;
  if (value === false) return <Minus className="mx-auto size-5 text-muted-foreground" aria-label="Not included" />;
  return <span>{value}</span>;
}

export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-10 px-4 py-12">
      <header className="space-y-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">One flat price. Bring the whole team.</h1>
        <p className="mx-auto max-w-xl text-muted-foreground">Free for as long as you like. Pro is {formatPrice(PLANS.pro.priceCents)} a month for the whole business.</p>
      </header>

      <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">Free and Pro compared</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="p-4 font-medium">
                <span className="sr-only">What you get</span>
              </th>
              <th scope="col" className="p-4 text-center font-semibold">
                Free
                <span className="block text-xs font-normal text-muted-foreground">R0</span>
              </th>
              <th scope="col" className="p-4 text-center font-semibold text-primary">
                Pro
                <span className="block text-xs font-normal text-muted-foreground">{formatPrice(PLANS.pro.priceCents)} a month</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ROWS.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="p-4 text-left font-normal">
                  {r.label}
                </th>
                <td className="p-4 text-center">
                  <Cell value={r.free} />
                </td>
                <td className="p-4 text-center">
                  <Cell value={r.pro} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-center">
        <Link href="/start" className={buttonVariants({ size: "touch" })}>
          Start free
        </Link>
      </div>

      <section aria-labelledby="faq" className="space-y-4">
        <h2 id="faq" className="text-xl font-semibold tracking-tight">
          Questions
        </h2>
        <dl className="space-y-4">
          {FAQ.map(([q, a]) => (
            <div key={q} className="rounded-2xl border bg-card p-4 shadow-card">
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
