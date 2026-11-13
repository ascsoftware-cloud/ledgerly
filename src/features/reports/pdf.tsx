import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { renderToBuffer } from "@react-pdf/renderer";
import type { ReportTable } from "./schema";

// Built-in Helvetica, like the invoice PDF: no font files to ship.
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#0f172a" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  muted: { color: "#566176", marginBottom: 16 },
  th: { flexDirection: "row", borderBottom: "1 solid #0f172a", paddingVertical: 5, fontFamily: "Helvetica-Bold", fontSize: 9 },
  tr: { flexDirection: "row", borderBottom: "0.5 solid #e2e6ec", paddingVertical: 5 },
  foot: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: "#566176", textAlign: "center" },
});

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** A report table as an A4 PDF. The first column is wide; amount-like cells are right-aligned. */
export function ReportPdf({ table, business, generatedOn }: { table: ReportTable; business: string; generatedOn: string }) {
  const cols = table.headers.length;
  const widths = table.headers.map((_, i) => (i === 0 ? 3 : 1.4));
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (text: string, i: number, bold = false) => (
    <Text key={i} style={{ width: `${(widths[i]! / total) * 100}%`, textAlign: i > 0 && (NUMERIC.test(text) || i === cols - 1) ? "right" : "left", fontFamily: bold ? "Helvetica-Bold" : "Helvetica", paddingRight: 4 }}>
      {text}
    </Text>
  );
  return (
    <Document title={table.title} author={business} creator="Ledgerly">
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{table.title}</Text>
        <Text style={s.muted}>
          {business} · prepared {generatedOn} · amounts in rand
        </Text>
        <View style={s.th}>{table.headers.map((h, i) => cell(h, i, true))}</View>
        {table.rows.map((row, r) => (
          <View key={r} style={s.tr} wrap={false}>
            {row.map((c, i) => cell(c, i, i === 0 && /^(Total|Net income|Profit|VAT payable)/.test(row[0] ?? "")))}
          </View>
        ))}
        <Text style={s.foot} fixed>
          Ledgerly · prepared from your invoices and expenses on an invoice basis. Check with your accountant before filing.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(table: ReportTable, business: string, generatedOn: string): Promise<Buffer> {
  return renderToBuffer(ReportPdf({ table, business, generatedOn }));
}
