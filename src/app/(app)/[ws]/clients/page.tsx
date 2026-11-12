import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Building2, FileUp, Plus, Search, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ClientsTabs } from "@/features/clients/components/clients-tabs";
import { UndoArchive } from "@/features/clients/components/undo-archive";
import { getContact, listContacts } from "@/features/clients/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Clients", robots: { index: false } };

export default function ClientsPage({ params, searchParams }: PageProps<"/[ws]/clients">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Clients params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Clients({
  params,
  searchParams,
}: {
  params: PageProps<"/[ws]/clients">["params"];
  searchParams: PageProps<"/[ws]/clients">["searchParams"];
}) {
  const { ws } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const ctx = await requireWorkspace(ws);
  const [contacts, justArchived] = await Promise.all([
    listContacts(ctx, q),
    typeof sp.archived === "string" ? getContact(ctx, sp.archived) : null,
  ]);
  const canWrite = ctx.role !== "accountant";

  return (
    <div className="space-y-6">
      {justArchived?.deletedAt && <UndoArchive slug={ws} contactId={justArchived.id} name={justArchived.name} />}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        {canWrite && (
          <div className="flex gap-2">
            <Link href={`/${ws}/clients/import`} className={buttonVariants({ variant: "outline", size: "touch" })}>
              <FileUp className="size-5" aria-hidden />
              Import
            </Link>
            <Link href={`/${ws}/clients/new`} className={buttonVariants({ size: "touch" })}>
              <Plus className="size-5" aria-hidden />
              Add client
            </Link>
          </div>
        )}
      </header>
      <ClientsTabs slug={ws} current="list" />

      {(contacts.length > 0 || q) && (
        <form role="search" className="relative">
          <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="q" className="sr-only">
            Search clients
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search by name, email or phone"
            className="h-12 w-full rounded-xl border bg-card pr-4 pl-10 text-base outline-none focus-visible:border-ring"
          />
        </form>
      )}

      {contacts.length === 0 ? (
        q ? (
          <EmptyState
            icon={Search}
            title={`Nothing matches “${q}”`}
            body="Try part of a name, an email or a phone number."
            action={{ label: "Clear search", href: `/${ws}/clients` }}
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No clients yet"
            body="Add the people and businesses you work for. Then send them a quote or invoice in a tap."
            action={
              canWrite
                ? { label: "Add your first client", href: `/${ws}/clients/new` }
                : { label: "Back to home", href: `/${ws}` }
            }
          />
        )
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Clients">
          {contacts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/${ws}/clients/${c.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/60"
              >
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-primary"
                >
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details yet"}
                  </span>
                </span>
                {c.companies && (
                  <span className="hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
                    <Building2 className="size-4" aria-hidden />
                    {c.companies.name}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
