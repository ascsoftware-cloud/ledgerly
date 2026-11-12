import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentViewData } from "../components/document-view";
import { DocumentPdf } from "./document-pdf";

/** The same content as DocumentView, as a printable A4 PDF. */
export async function renderDocumentPdf(d: DocumentViewData): Promise<Buffer> {
  // DocumentPdf returns the <Document> element renderToBuffer expects.
  return renderToBuffer(DocumentPdf({ d }));
}

export function pdfFileName(d: DocumentViewData): string {
  const base = d.number ?? "draft";
  return `${base.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}
