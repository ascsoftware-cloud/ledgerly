import Link from "next/link";
import { Check, FileText, MessageCircle, Sparkles, Wallet } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { buttonVariants } from "@/components/ui/button";
import { formatPrice, PLANS } from "@/lib/plans";
import { siteUrl } from "@/lib/site-url";

const BENEFITS = [
  {
    icon: Sparkles,
    title: "Set up in a few taps",
    body: "Answer eight quick questions. Your workspace arrives ready, with only the tools you need switched on.",
  },
  {
    icon: Wallet,
    title: "Get paid the South African way",
    body: "Card payments through Yoco or PayFast, or plain EFT. The money goes straight to your account, never through us.",
  },
  {
    icon: MessageCircle,
    title: "Send it on WhatsApp",
    body: "Share any invoice or quote in one tap. Your client views, signs and pays on their phone.",
  },
] as const;

const STEPS = [
  ["Tell us about your business", "No forms. Just tap the cards that fit."],
  ["Add a client and a price", "Two fields. VAT at 15% is one switch away."],
  ["Send your first invoice", "By email or WhatsApp, in under three minutes."],
] as const;

const FREE = ["10 invoices or quotes a month", "Unlimited clients and team members", "Expenses, tasks and bookings"];
const PRO = ["Unlimited invoices and quotes", "Your own branding and client portal", "Reminders that send themselves"];

export default function LandingPage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Organization", name: "Ledgerly", url: siteUrl() },
            {
              "@type": "SoftwareApplication",
              name: "Ledgerly",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web, Android, iOS",
              description: "Invoices, clients, expenses, tasks and bookings in one simple app, built for South African small businesses.",
              offers: [
                { "@type": "Offer", name: "Free", price: "0", priceCurrency: "ZAR" },
                { "@type": "Offer", name: "Pro", price: String(PLANS.pro.priceCents / 100), priceCurrency: "ZAR" },
              ],
            },
          ],
        }}
      />
      <section className="mx-auto w-full max-w-5xl px-4 pt-16 pb-12 text-center sm:pt-24">
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Run your whole business from one simple app
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
          Invoices, clients, expenses, tasks and bookings in one place. Built for South African small
          businesses. Free to start.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/start" className={buttonVariants({ size: "touch", className: "w-full sm:w-auto" })}>
            Get started free
          </Link>
          <p className="text-sm text-muted-foreground">No password. No card needed.</p>
        </div>
      </section>

      <section aria-labelledby="benefits" className="mx-auto w-full max-w-5xl px-4 py-12">
        <h2 id="benefits" className="sr-only">
          Why Ledgerly
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-2xl border bg-card p-6 shadow-card">
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how" className="mx-auto w-full max-w-5xl px-4 py-12">
        <h2 id="how" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          First invoice out in three minutes
        </h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="flex gap-4 rounded-2xl bg-muted p-6">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="pricing" className="mx-auto w-full max-w-5xl px-4 py-12">
        <h2 id="pricing" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          One flat price. Bring the whole team.
        </h2>
        <div className="mx-auto mt-8 grid max-w-3xl gap-4 md:grid-cols-2">
          <PlanCard name="Free" price="R 0" note="for as long as you like" features={FREE} cta="Start free" />
          <PlanCard
            name="Pro"
            price={formatPrice(PLANS.pro.priceCents)}
            note="per month, unlimited users"
            features={PRO}
            cta="Start free, upgrade later"
            highlight
          />
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pt-4 pb-20 text-center">
        <div className="rounded-3xl bg-accent px-6 py-12">
          <FileText className="mx-auto size-8 text-primary" aria-hidden />
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">Ready when you are</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            Eight taps to set up. Sign in with Google or your email at the end.
          </p>
          <Link href="/start" className={buttonVariants({ size: "touch", className: "mt-6" })}>
            Get started
          </Link>
        </div>
      </section>
    </>
  );
}

function PlanCard({
  name,
  price,
  note,
  features,
  cta,
  highlight = false,
}: {
  name: string;
  price: string;
  note: string;
  features: readonly string[];
  cta: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col rounded-2xl border bg-card p-6 ${highlight ? "border-primary shadow-raised" : "shadow-card"}`}
    >
      <h3 className="text-sm font-medium text-muted-foreground">{name}</h3>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{price}</p>
      <p className="text-sm text-muted-foreground">{note}</p>
      <ul className="mt-5 flex-1 space-y-2 text-sm">
        {features.map((f) => (
          <li key={f} className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
      <Link
        href="/start"
        className={buttonVariants({
          size: "touch",
          variant: highlight ? "default" : "outline",
          className: "mt-6",
        })}
      >
        {cta}
      </Link>
    </div>
  );
}
