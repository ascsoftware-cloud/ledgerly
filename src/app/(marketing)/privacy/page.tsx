import type { Metadata } from "next";
import Link from "next/link";
import { CompanyBlock, LegalPage } from "@/components/legal-page";
import { getCompany } from "@/lib/company";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Ledgerly collects, why, who it is shared with, how long it is kept, and how to use your rights under POPIA.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const c = getCompany();
  return (
    <LegalPage title="Privacy policy" updated="13 November 2026">
      <p>
        This policy explains how Ledgerly handles personal information, in line with the Protection of Personal Information Act (POPIA). It is written in plain words on purpose.
      </p>

      <h2>Who we are</h2>
      <CompanyBlock />
      <p>
        Our information officer is {c.infoOfficer}. See our <Link className="underline underline-offset-4" href="/popia">POPIA page</Link> for how to contact them.
      </p>

      <h2>Two roles</h2>
      <p>
        For your own sign-in details, we decide why and how they are used, so we are the <strong>responsible party</strong>. For the information you put into Ledgerly about your clients, suppliers, staff and sales, <strong>you</strong> decide why and how it is used, and we only store and process it for you as your <strong>operator</strong>. If you are a client of a business that uses Ledgerly, ask that business about your information.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Your account: your email address, and your name and profile picture if you sign in with Google.</li>
        <li>What you add: clients, invoices, quotes, expenses, tasks, bookings, products, files and notes for your business, and your team members&apos; names and roles.</li>
        <li>Technical details needed to keep the service safe: your IP address and device type when you sign in, send a document, or sign a contract (kept with the signature record), and counters that limit abuse.</li>
        <li>Notification settings, and, if you turn on push, the address your browser gives us for that device.</li>
        <li>For Pro: that a subscription exists, its status and dates. Your card is entered on PayFast&apos;s page. We never see or keep card numbers.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To provide Ledgerly to you and your team: that is our contract with you.</li>
        <li>To keep it secure, prevent abuse and fix faults: our legitimate interest, and yours.</li>
        <li>To send what you ask for: invoices, reminders, sign-in links and notifications.</li>
        <li>Miko, the AI helper, which is on for every business unless an owner or admin switches it off. Nothing is sent until someone asks Miko a question or asks it to read a receipt photo. Your question (everything you type) and the client names and amounts needed to answer it go to our AI provider. Miko is built not to look up client email addresses, phone numbers or addresses, but anything you type yourself, or show in a receipt photo you ask it to read, is sent. An owner or admin can switch Miko off at any time.</li>
      </ul>
      <p>We do not sell personal information, and we do not use it for advertising.</p>

      <h2>Who else handles it</h2>
      <p>We use these services to run Ledgerly. Each only gets what it needs:</p>
      <ul>
        <li>Supabase: database, sign-in and file storage (hosted in {c.dataRegion}).</li>
        <li>Vercel: hosting and delivery of the website and app.</li>
        <li>Resend: sending email.</li>
        <li>Google: sign-in, if you choose it.</li>
        <li>PayFast: Pro subscription payments. It receives the business owner&apos;s email address and first name. Businesses also connect their own PayFast, Yoco or Stitch accounts, which pay the business directly.</li>
        <li>Apps you connect (Xero, Sage, Shopify, Courier Guy): they receive the information you choose to send to them, and only after you connect them.</li>
        <li>Groq: Miko, the AI helper, when someone in your business uses it. According to Groq&apos;s published terms (checked in November 2026), it does not keep requests or train on them by default.</li>
        <li>Your browser&apos;s push service (Apple, Google or Mozilla), only if you turn on push.</li>
        <li>An error-reporting service, if we switch one on: it receives the error type, a message with email addresses and long codes removed, and the page address with link codes hidden. We do not send request contents, and we cannot promise every personal detail in an error message is caught.</li>
      </ul>
      <p>Some of these are outside South Africa. When information is sent abroad we use providers with appropriate protections, as POPIA section 72 requires.</p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while your account is open. When you ask us to delete a business or your account, we keep it for 7 days in case you change your mind, then delete the records and files in our next nightly clean-up (so within about 8 days). Backups made by our providers expire on their own schedule. Records of payments you made to us for Pro are kept, without your business attached, for as long as the law requires us to keep accounting records.
      </p>

      <h2>How we protect it</h2>
      <ul>
        <li>Every business&apos;s data is separated by the database itself, not just by the app, and this is tested.</li>
        <li>Sign-in is passwordless (Google, or a code or link we email you), so there is no password to steal.</li>
        <li>Files are private and only reachable through short-lived links.</li>
        <li>Connections are encrypted.</li>
      </ul>
      <p>If personal information is ever accessed by someone who should not have had it, we will tell the Information Regulator and the people affected, as POPIA requires.</p>

      <h2>Cookies and similar storage</h2>
      <p>
        We only use what the app needs to work: a sign-in session, your theme and sidebar choices, and, if you use the installed app, saved copies of pages for reading offline (removed when you sign out). We use no advertising or tracking cookies.
      </p>

      <h2>Your rights</h2>
      <p>You can ask us to tell you what we hold about you, correct it, delete it, or stop using it in a particular way. You can export all of your business&apos;s data and delete your business or account yourself in Settings. Or write to us at {c.contactEmail}.</p>
      <p>
        If you are not happy with how we handled your request, you can complain to the Information Regulator (South Africa): inforegulator.org.za.
      </p>

      <h2>Children</h2>
      <p>Ledgerly is for businesses and is not meant for people under 18.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will tell you in the app or by email before it starts to apply.</p>
    </LegalPage>
  );
}
