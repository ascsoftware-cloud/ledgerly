import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ContractActions, ContractDraftForm } from "@/features/documents/components/contract-tools";
import { getContract, getPortalToken } from "@/features/documents/queries";
import { CONTRACT_STATUS_LABEL } from "@/features/documents/schema";
import { getContact } from "@/features/clients/queries";
import { formatDate } from "@/lib/dates";
import { siteUrl } from "@/lib/site-url";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Contract", robots: { index: false } };

const when = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export default function ContractPage({ params }: PageProps<"/[ws]/docs/contracts/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <Contract params={params} />
    </Suspense>
  );
}

async function Contract({ params }: { params: PageProps<"/[ws]/docs/contracts/[id]">["params"] }) {
  const { ws, id } = await params;
  const ctx = await requireWorkspace(ws);
  const k = await getContract(ctx, id);
  if (!k) notFound();
  const canWrite = ctx.role !== "accountant";
  const [token, contact] = await Promise.all([canWrite ? getPortalToken(ctx, k.contact_id) : Promise.resolve(null), getContact(ctx, k.contact_id)]);
  const sig = k.contract_signatures[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/docs/contracts`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Contracts
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{k.title}</h1>
        <p className="text-muted-foreground">
          <Link href={`/${ws}/clients/${k.contact_id}`} className="hover:text-primary">
            {k.contacts?.name ?? "Client"}
          </Link>{" "}
          · {CONTRACT_STATUS_LABEL[k.status]}
          {k.sent_at ? ` · sent ${formatDate(k.sent_at.slice(0, 10))}` : ""}
        </p>
      </header>

      {k.status === "draft" && canWrite ? (
        <ContractDraftForm slug={ws} id={k.id} title={k.title} body={k.body} />
      ) : (
        <article aria-label="Contract text" className="whitespace-pre-wrap rounded-2xl border bg-card p-5 leading-relaxed shadow-card">
          {k.body}
        </article>
      )}

      {sig && (
        <section aria-labelledby="sig-heading" className="space-y-2 rounded-2xl border bg-card p-5 shadow-card">
          <h2 id="sig-heading" className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-5 text-success" aria-hidden /> Signed by {sig.signer_name}
          </h2>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">When</dt>
            <dd>{when.format(new Date(sig.signed_at))}</dd>
            <dt className="text-muted-foreground">From</dt>
            <dd className="break-all">{sig.ip_address ?? "—"}</dd>
            <dt className="text-muted-foreground">Fingerprint</dt>
            <dd className="font-mono text-xs break-all">{sig.document_hash}</dd>
          </dl>
          {sig.signature_image && (
            // A small PNG the signer drew: an image, never HTML.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sig.signature_image} alt={`Signature drawn by ${sig.signer_name}`} className="h-24 rounded-lg border bg-background" />
          )}
          <p className="text-xs text-muted-foreground">
            An ordinary electronic signature under the ECT Act. The fingerprint is the SHA-256 of the title and text exactly as the client saw them; it changes if a single character is edited.
          </p>
        </section>
      )}

      {canWrite && (
        <ContractActions
          slug={ws}
          id={k.id}
          contactId={k.contact_id}
          status={k.status}
          canVoid={ctx.role === "owner" || ctx.role === "admin"}
          clientHasEmail={Boolean(contact?.email)}
          portalLink={token ? `${siteUrl()}/portal/${token}` : null}
        />
      )}
    </div>
  );
}
