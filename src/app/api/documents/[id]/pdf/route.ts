import { z } from "zod";
import { getDocument } from "@/features/sales/queries";
import { pdfFileName, renderDocumentPdf } from "@/features/sales/pdf/render";
import { toViewData } from "@/features/sales/view-data";
import { requireWorkspace } from "@/lib/workspace";

/** The business's own copy, drafts included. Signed-in members only (row-level security decides). */
export async function GET(req: Request, { params }: RouteContext<"/api/documents/[id]/pdf">) {
  const { id } = await params;
  const slug = new URL(req.url).searchParams.get("ws") ?? "";
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const ctx = await requireWorkspace(slug);
  const d = await getDocument(ctx, id);
  if (!d) return new Response("Not found", { status: 404 });
  const view = toViewData(d);
  const pdf = await renderDocumentPdf(view);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(view)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
