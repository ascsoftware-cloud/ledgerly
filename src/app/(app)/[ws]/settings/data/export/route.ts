import { buildExportZip, exportFileName, type ExportFile } from "@/features/privacy/export-zip";
import { rateLimit } from "@/lib/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";

const BUCKETS = ["receipts", "payment-proofs", "documents"] as const;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 500;

type Db = Awaited<ReturnType<typeof createServerClient>>;

async function listAll(db: Db, bucket: string, prefix: string): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data } = await db.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (!data?.length) break;
    for (const item of data) {
      const path = `${prefix}/${item.name}`;
      if (item.id === null) out.push(...(await listAll(db, bucket, path)));
      else out.push({ path, size: Number((item.metadata as { size?: number } | null)?.size ?? 0) });
    }
    if (data.length < 100) break;
  }
  return out;
}

/**
 * A ZIP of everything this business holds: one JSON file per table and the uploaded files. The owner only. It
 * is built as the signed-in owner, so row-level security decides what is in it (migration 0039).
 */
export async function GET(_req: Request, { params }: RouteContext<"/[ws]/settings/data/export">) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role !== "owner") return new Response("Not found", { status: 404 });
  if (!(await rateLimit("export-user", ctx.user.id, 5, 3600))) return new Response("Too many exports. Please try again in an hour.", { status: 429 });

  const db = await createServerClient();
  const { data, error } = await db.rpc("export_workspace", { p_workspace: ctx.workspace.id });
  if (error || typeof data !== "object" || data === null) return new Response("The export failed. Please try again.", { status: 500 });

  const files: ExportFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const bucket of BUCKETS) {
    for (const f of await listAll(db, bucket, ctx.workspace.id)) {
      const name = `${bucket}/${f.path.slice(ctx.workspace.id.length + 1)}`;
      if (files.length >= MAX_FILES || f.size > MAX_FILE_BYTES || total + f.size > MAX_TOTAL_BYTES) {
        skipped.push(name);
        continue;
      }
      const { data: blob } = await db.storage.from(bucket).download(f.path);
      if (!blob) {
        skipped.push(name);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      total += bytes.length;
      files.push({ name, bytes });
    }
  }

  const now = new Date();
  const zip = buildExportZip({ slug: ctx.workspace.slug, exportedAt: now, data: data as Record<string, unknown[]>, files, skipped });
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${exportFileName(ctx.workspace.slug, now)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
