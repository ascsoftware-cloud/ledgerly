import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Building2, FileText, Mail, MapPin, MessageCircle, Pencil, Phone } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ArchiveButton } from "@/features/clients/components/archive-button";
import { NoteForm } from "@/features/clients/components/note-form";
import { getContact } from "@/features/clients/queries";
import { PortalPanel } from "@/features/documents/components/portal-panel";
import { getPortalToken } from "@/features/documents/queries";
import { siteUrl } from "@/lib/site-url";
import { formatDate, todaySAST } from "@/lib/dates";
import { whatsappNumber } from "@/lib/phone";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Client", robots: { index: false } };

const day = (iso: string) => formatDate(todaySAST(new Date(iso)));

export default function ClientPage({ params }: PageProps<"/[ws]/clients/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Client params={params} />
    </Suspense>
  );
}

async function Client({ params }: { params: PageProps<"/[ws]/clients/[id]">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const c = await getContact(ctx, id);
  if (!c) notFound();
  const canWrite = ctx.role !== "accountant";
  // The portal link is a secret: only people who can share it (not the read-only accountant) see it.
  const portalToken = canWrite && !c.deletedAt ? await getPortalToken(ctx, c.id) : null;

  return (
    <div className="space-y-6">
      <Link href={`/${ws}/clients`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Clients
      </Link>

      {c.deletedAt && (
        <p className="rounded-xl border bg-muted px-4 py-3 text-sm">This client is archived.</p>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          {c.companies && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="size-4" aria-hidden /> {c.companies.name}
            </p>
          )}
        </div>
        {canWrite && !c.deletedAt && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/${ws}/money/new?kind=invoice&client=${c.id}`} className={buttonVariants({ size: "touch" })}>
              <FileText className="size-5" aria-hidden /> New invoice
            </Link>
            <Link href={`/${ws}/clients/${c.id}/edit`} className={buttonVariants({ variant: "outline", size: "touch" })}>
              <Pencil className="size-5" aria-hidden /> Edit
            </Link>
            <ArchiveButton slug={ws} contactId={c.id} />
          </div>
        )}
      </header>

      <section aria-label="Contact details" className="grid gap-2 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
        {c.email ? (
          <a href={`mailto:${c.email}`} className="flex min-h-11 items-center gap-2 hover:text-primary">
            <Mail className="size-5 text-muted-foreground" aria-hidden /> {c.email}
          </a>
        ) : null}
        {c.phone ? (
          <>
            <a href={`tel:${c.phone}`} className="flex min-h-11 items-center gap-2 hover:text-primary">
              <Phone className="size-5 text-muted-foreground" aria-hidden /> {c.phone}
            </a>
            <a
              href={`https://wa.me/${whatsappNumber(c.phone)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center gap-2 hover:text-primary"
            >
              <MessageCircle className="size-5 text-muted-foreground" aria-hidden /> WhatsApp
            </a>
          </>
        ) : null}
        {c.address && (
          <p className="flex min-h-11 items-center gap-2 whitespace-pre-line">
            <MapPin className="size-5 shrink-0 text-muted-foreground" aria-hidden /> {c.address}
          </p>
        )}
        {!c.email && !c.phone && !c.address && (
          <p className="text-muted-foreground">No contact details yet.</p>
        )}
      </section>

      {canWrite && !c.deletedAt && (
        <PortalPanel slug={ws} contactId={c.id} link={portalToken ? `${siteUrl()}/portal/${portalToken}` : null} hasEmail={Boolean(c.email)} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="notes-heading" className="space-y-3">
          <h2 id="notes-heading" className="text-lg font-semibold">Notes</h2>
          {canWrite && !c.deletedAt && <NoteForm slug={ws} contactId={c.id} />}
          {c.notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {c.notes.map((n) => (
                <li key={n.id} className="rounded-xl border bg-card p-4">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{day(n.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="timeline-heading" className="space-y-3">
          <h2 id="timeline-heading" className="text-lg font-semibold">Timeline</h2>
          <ol className="space-y-3 border-l pl-4">
            {c.activities.map((a) => (
              <li key={a.id} className="relative">
                <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-primary" />
                <p className="text-sm">{a.summary}</p>
                <p className="text-xs text-muted-foreground">{day(a.created_at)}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
