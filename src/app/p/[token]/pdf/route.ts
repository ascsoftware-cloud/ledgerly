import { publicToViewData } from "@/features/sales/public";
import { loadPublicDocument } from "@/features/sales/public-data";
import { pdfFileName, renderDocumentPdf } from "@/features/sales/pdf/render";

/** The client's copy as a PDF, from the same link token. */
export async function GET(_req: Request, { params }: RouteContext<"/p/[token]/pdf">) {
  const { token } = await params;
  const res = await loadPublicDocument(token);
  if (res.kind === "busy") return new Response("Too many requests", { status: 429 });
  if (res.kind === "missing") return new Response("Not found", { status: 404 });
  const view = publicToViewData(res.doc);
  const pdf = await renderDocumentPdf(view);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdfFileName(view)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
