import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { BusinessForm } from "@/features/business/components/business-form";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Business details", robots: { index: false } };

export default function BusinessPage({ params }: PageProps<"/[ws]/settings/business">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Business params={params} />
    </Suspense>
  );
}

async function Business({ params }: { params: PageProps<"/[ws]/settings/business">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const canEdit = ctx.role === "owner" || ctx.role === "admin";
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("workspace_settings")
    .select("business_name, registration_number, vat_registered, vat_number")
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  const initial = {
    name: ((data?.business_name as string | null)?.trim() || ctx.workspace.name) as string,
    registration: (data?.registration_number as string | null) ?? "",
    vatRegistered: data?.vat_registered === true,
    vatNumber: (data?.vat_number as string | null) ?? "",
  };
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${ws}/more`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> More
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Business details</h1>
      <p className="text-sm text-muted-foreground">Your business name and tax details, as they appear in the app and on your documents.</p>
      {canEdit ? (
        <BusinessForm slug={ws} initial={initial} />
      ) : (
        <dl className="space-y-3 rounded-2xl border bg-card p-5 text-sm shadow-card">
          <div>
            <dt className="text-muted-foreground">Business name</dt>
            <dd className="font-medium">{initial.name}</dd>
          </div>
          <p className="text-muted-foreground">Only owners and admins can change these.</p>
        </dl>
      )}
    </div>
  );
}
