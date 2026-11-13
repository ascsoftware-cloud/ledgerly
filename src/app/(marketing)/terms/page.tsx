import type { Metadata } from "next";
import Link from "next/link";
import { CompanyBlock, LegalPage } from "@/components/legal-page";
import { formatPrice, PLANS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for using Ledgerly: accounts, plans and billing, your data, acceptable use and how to leave.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="13 November 2026">
      <p>These terms are the agreement between you and the company below when you use Ledgerly. Please read them. By creating an account or using Ledgerly you accept them.</p>
      <CompanyBlock />

      <h2>What Ledgerly is</h2>
      <p>
        Ledgerly is software for small businesses to manage clients, invoices, quotes, expenses, tasks, bookings and related records. It is a tool: it does not give accounting, tax, legal or financial advice, and you are responsible for the accuracy of your own records, invoices and VAT. Ask your accountant when you are unsure.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 18 and able to enter a contract for your business.</li>
        <li>The person who creates a business is its owner. Owners are responsible for who they invite and for what their team does.</li>
        <li>Keep your sign-in method secure. Tell us if you think someone else has access.</li>
      </ul>

      <h2>Plans and billing</h2>
      <ul>
        <li>Free is free for as long as you like, within the limits shown on the <Link className="underline underline-offset-4" href="/pricing">pricing page</Link>.</li>
        <li>Pro costs {formatPrice(PLANS.pro.priceCents)} a month per business, billed monthly in rand through PayFast until you cancel. We will tell you before the price changes, and a change only applies from your next month.</li>
        <li>You can cancel at any time. Pro continues until the end of the month you have paid for, then the business returns to Free. We do not delete or hide your data when you downgrade, and you can always view and export it.</li>
        <li>[Refund terms: to confirm]</li>
      </ul>

      <h2>Money your clients pay you</h2>
      <p>
        When your clients pay through your own PayFast, Yoco or Stitch account, the money goes to you. Ledgerly never holds it, and is not a party to the sale between you and your client.
      </p>

      <h2>Your data</h2>
      <p>
        Your data stays yours. You give us permission to store and process it only to run Ledgerly for you. You can export it and delete your business or account whenever you like. See our <Link className="underline underline-offset-4" href="/privacy">privacy policy</Link>.
      </p>

      <h2>The AI helper</h2>
      <p>
        Miko, the AI helper, is on for every business unless an owner or admin switches it off. Its answers can be wrong: check anything that matters before you rely on it. It can only read your records and cannot change, send or delete anything.
      </p>

      <h2>Acceptable use</h2>
      <p>Do not use Ledgerly to break the law, send spam or scams, store content you have no right to store, attack or overload the service, or try to reach another business&apos;s data. We may suspend an account that does, and will tell you why when we can.</p>

      <h2>Availability</h2>
      <p>We work to keep Ledgerly running and your data safe, but we cannot promise it will never be down or free of faults. Keep your own copy of anything you cannot do without: you can export it at any time.</p>

      <h2>Our responsibility</h2>
      <p>[Limitation of liability: to be written with the company&apos;s lawyer.] Nothing in these terms limits any right you have under South African consumer law that cannot be limited.</p>

      <h2>Ending the agreement</h2>
      <p>You can stop using Ledgerly and delete your account at any time. We may end the agreement if you seriously or repeatedly break these terms, and we will give you the chance to export your data first unless the law or safety prevents it.</p>

      <h2>Changes and law</h2>
      <p>We may update these terms and will tell you in the app or by email before an important change applies. These terms are governed by the laws of South Africa.</p>
    </LegalPage>
  );
}
