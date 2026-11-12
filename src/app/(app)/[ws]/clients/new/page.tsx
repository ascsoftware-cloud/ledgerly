import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ContactForm } from "@/features/clients/components/contact-form";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Add client", robots: { index: false } };

export default function NewClientPage({ params }: PageProps<"/[ws]/clients/new">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <NewClient params={params} />
    </Suspense>
  );
}

async function NewClient({ params }: { params: PageProps<"/[ws]/clients/new">["params"] }) {
  const { ws } = await params;
  await requireWorkspace(ws);
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link href={`/${ws}/clients`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Clients
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add a client</h1>
      <ContactForm slug={ws} contactId={null} submitLabel="Add client" />
    </div>
  );
}
