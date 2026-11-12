import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ContactForm } from "@/features/clients/components/contact-form";
import { getContact } from "@/features/clients/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Edit client", robots: { index: false } };

export default function EditClientPage({ params }: PageProps<"/[ws]/clients/[id]/edit">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <EditClient params={params} />
    </Suspense>
  );
}

async function EditClient({ params }: { params: PageProps<"/[ws]/clients/[id]/edit">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const c = await getContact(ctx, id);
  if (!c || c.deletedAt || ctx.role === "accountant") notFound();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link href={`/${ws}/clients/${c.id}`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {c.name}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Edit client</h1>
      <ContactForm
        slug={ws}
        contactId={c.id}
        submitLabel="Save changes"
        initial={{
          name: c.name,
          email: c.email ?? "",
          phone: c.phone ?? "",
          company: c.companies?.name ?? "",
          address: c.address ?? "",
        }}
      />
    </div>
  );
}
