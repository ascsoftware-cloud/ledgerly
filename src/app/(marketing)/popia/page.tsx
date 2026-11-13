import type { Metadata } from "next";
import Link from "next/link";
import { CompanyBlock, LegalPage } from "@/components/legal-page";
import { getCompany } from "@/lib/company";

export const metadata: Metadata = {
  title: "POPIA and PAIA notice",
  description: "Our information officer, how to ask for your personal information, and how to complain.",
  alternates: { canonical: "/popia" },
};

export default function PopiaPage() {
  const c = getCompany();
  return (
    <LegalPage title="POPIA and PAIA notice" updated="13 November 2026">
      <p>
        This page says who is responsible for personal information at Ledgerly and how to use your rights under the Protection of Personal Information Act (POPIA) and the Promotion of Access to Information Act (PAIA).
      </p>

      <h2>Our details</h2>
      <CompanyBlock />

      <h2>Information officer</h2>
      <p>
        Our information officer is {c.infoOfficer}. Write to {c.contactEmail} with &ldquo;Information officer&rdquo; in the subject line.
      </p>

      <h2>What you can ask for</h2>
      <ul>
        <li>To know whether we hold personal information about you, and to see it.</li>
        <li>To have it corrected, or deleted when we no longer have a reason to keep it.</li>
        <li>To object to how it is used.</li>
        <li>To withdraw consent you gave us, such as for push notifications or the AI helper.</li>
      </ul>
      <p>
        If you use Ledgerly, you can export your business&apos;s data and delete your business or account yourself in Settings. If you are a client of a business that uses Ledgerly, that business is the responsible party for your information: please ask them first. We will help them respond.
      </p>
      <p>We will reply to a request within 30 days. We may need to confirm who you are first.</p>

      <h2>Purpose and categories</h2>
      <p>
        We collect personal information to provide Ledgerly (accounts, records you enter, notifications) and to keep it secure. The details are in our <Link className="underline underline-offset-4" href="/privacy">privacy policy</Link>, including who else handles it and where it is stored.
      </p>

      <h2>PAIA manual</h2>
      <p>[Link to the PAIA manual: to confirm]</p>

      <h2>If something goes wrong</h2>
      <p>
        If we learn that personal information has been accessed by an unauthorised person, we will tell the Information Regulator and the people affected as soon as reasonably possible, and say what happened and what they can do.
      </p>

      <h2>Complaints</h2>
      <p>
        You may complain to us first. You can also complain to the Information Regulator (South Africa) at inforegulator.org.za.
      </p>
    </LegalPage>
  );
}
