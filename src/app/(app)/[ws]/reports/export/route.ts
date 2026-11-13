import { loadReport } from "@/features/reports/queries";
import { renderReportPdf } from "@/features/reports/pdf";
import { csvFor, isReportKind, resolvePeriod, tableFor } from "@/features/reports/schema";
import { formatDate, todaySAST } from "@/lib/dates";
import { requireWorkspace } from "@/lib/workspace";

/** CSV or PDF of one report. Owners, admins and accountants only; anyone else gets "not found". */
export async function GET(req: Request, { params }: RouteContext<"/[ws]/reports/export">) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "staff") return new Response("Not found", { status: 404 });

  const q = new URL(req.url).searchParams;
  const kind = q.get("r");
  const format = q.get("format");
  if (!isReportKind(kind) || (format !== "csv" && format !== "pdf")) return new Response("Not found", { status: 404 });

  const today = todaySAST();
  const period = resolvePeriod({ period: q.get("period") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined }, today);
  const report = await loadReport(ctx, kind, period, today);
  if (!report) return new Response("Not found", { status: 404 });

  const label = kind === "aged" || kind === "cashflow" ? formatDate(today) : period.label;
  const table = tableFor(report, label);
  const stem = `ledgerly-${kind}-${kind === "aged" || kind === "cashflow" ? today : period.from}`;
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

  if (format === "csv") {
    // The byte-order mark makes Excel read the file as UTF-8 (names with accents).
    return new Response(`﻿${csvFor(table)}\r\n`, {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${stem}.csv"` },
    });
  }
  const pdf = await renderReportPdf(table, ctx.workspace.name, formatDate(today));
  return new Response(new Uint8Array(pdf), {
    headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${stem}.pdf"` },
  });
}
