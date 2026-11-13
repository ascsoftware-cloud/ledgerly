import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileText, FolderOpen } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { DocSections } from "@/features/documents/components/doc-sections";
import { ArchiveFolderButton, FileActions, NewFolderForm, UploadForm } from "@/features/documents/components/file-tools";
import { listFiles, listFolders } from "@/features/documents/queries";
import { formatDate } from "@/lib/dates";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Documents", robots: { index: false } };

const size = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function DocsPage({ params, searchParams }: PageProps<"/[ws]/docs">) {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <Docs params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Docs({ params, searchParams }: { params: PageProps<"/[ws]/docs">["params"]; searchParams: PageProps<"/[ws]/docs">["searchParams"] }) {
  const { ws } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(ws);
  const canWrite = ctx.role !== "accountant";
  const folders = await listFolders(ctx);
  const raw = typeof sp.folder === "string" ? sp.folder : "all";
  const current = raw === "none" || folders.some((f) => f.id === raw) ? raw : "all";
  const files = await listFiles(ctx, current === "all" ? null : current);
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const chip = "inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium hover:border-primary aria-[current=true]:border-primary aria-[current=true]:bg-accent";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
      <DocSections slug={ws} current="files" />

      <nav aria-label="Folders" className="flex flex-wrap items-center gap-2">
        <Link href={`/${ws}/docs`} aria-current={current === "all" ? "true" : undefined} className={chip}>
          All files
        </Link>
        <Link href={`/${ws}/docs?folder=none`} aria-current={current === "none" ? "true" : undefined} className={chip}>
          No folder
        </Link>
        {folders.map((f) => (
          <Link key={f.id} href={`/${ws}/docs?folder=${f.id}`} aria-current={current === f.id ? "true" : undefined} className={chip}>
            <FolderOpen className="mr-1.5 size-4" aria-hidden /> {f.name}
          </Link>
        ))}
      </nav>

      {canWrite && (
        <div className="space-y-3">
          <UploadForm slug={ws} workspaceId={ctx.workspace.id} folders={folders} current={current} />
          <NewFolderForm slug={ws} />
        </div>
      )}

      {files.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No files here yet"
          body="Keep leases, insurance papers, certificates and signed documents in one safe place. Files are private and open with a short-lived link."
          action={{ label: canWrite ? "Back to all files" : "Back to home", href: canWrite ? `/${ws}/docs` : `/${ws}` }}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-card" aria-label="Files">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {size(f.size_bytes)} · {formatDate(f.created_at.slice(0, 10))}
                  {f.folder_id && folderName.get(f.folder_id) ? ` · ${folderName.get(f.folder_id)}` : ""}
                </span>
              </span>
              <FileActions slug={ws} id={f.id} name={f.name} canWrite={canWrite} />
            </li>
          ))}
        </ul>
      )}
      {canWrite && current !== "all" && current !== "none" && <ArchiveFolderButton slug={ws} id={current} name={folderName.get(current) ?? "folder"} />}
    </div>
  );
}
