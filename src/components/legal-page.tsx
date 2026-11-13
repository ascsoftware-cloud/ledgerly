import type { ReactNode } from "react";
import { getCompany } from "@/lib/company";

/** Shared frame for the legal pages. The text is a draft until a lawyer has read it and the company details are set. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const company = getCompany();
  return (
    <article className="mx-auto w-full max-w-3xl space-y-6 px-4 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">Last updated {updated}</p>
        {company.incomplete && (
          <p role="note" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Draft for review. Items shown as [to confirm] are filled in before launch, and a lawyer should read this page. It is not legal advice.
          </p>
        )}
      </header>
      <div className="space-y-6 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:ml-5 [&_li]:list-disc [&_p]:leading-7 [&_ul]:space-y-1">{children}</div>
    </article>
  );
}

export function CompanyBlock() {
  const c = getCompany();
  return (
    <ul aria-label="Who we are">
      <li>{c.name}</li>
      <li>Registration number: {c.registration}</li>
      <li>Address: {c.address}</li>
      <li>
        Email: <a className="underline underline-offset-4" href={`mailto:${c.contactEmail}`}>{c.contactEmail}</a>
      </li>
    </ul>
  );
}
