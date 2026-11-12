import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { DocumentViewData } from "../components/document-view";
import { balanceCents } from "../status";

// Built-in Helvetica covers what invoices need; no font files to ship.
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#0f172a" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottom: "1 solid #e2e6ec", paddingBottom: 16 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", textAlign: "right" },
  muted: { color: "#566176" },
  bold: { fontFamily: "Helvetica-Bold" },
  section: { paddingVertical: 14, borderBottom: "1 solid #e2e6ec" },
  label: { fontSize: 8, color: "#566176", textTransform: "uppercase", marginBottom: 2 },
  th: { fontSize: 8, color: "#566176", paddingVertical: 6, borderBottom: "1 solid #e2e6ec" },
  td: { paddingVertical: 6, borderBottom: "0.5 solid #e2e6ec" },
  desc: { flex: 4 },
  num: { flex: 1, textAlign: "right" },
  totals: { marginTop: 12, marginLeft: "auto", width: 220 },
  footer: { marginTop: 24, paddingTop: 12, borderTop: "1 solid #e2e6ec" },
});

function title(d: DocumentViewData): string {
  if (d.kind === "quote") return "Quote";
  if (d.kind === "credit_note") return "Credit note";
  return d.business.vatRegistered ? "Tax invoice" : "Invoice";
}

// PDF text cannot use the narrow no-break space the app uses for grouping.
const money = (c: number) => formatMoney(c).replace(/ /g, " ");

export function DocumentPdf({ d }: { d: DocumentViewData }) {
  const showVat = d.business.vatRegistered || d.lines.some((l) => l.vatRate > 0);
  const bank = d.kind === "invoice" ? d.business.bankDetails : null;

  return (
    <Document title={`${title(d)} ${d.number ?? ""}`.trim()} author={d.business.name} creator="Ledgerly">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={[s.bold, { fontSize: 13 }]}>{d.business.name}</Text>
            {d.business.vatRegistered && d.business.vatNumber ? <Text style={s.muted}>VAT no. {d.business.vatNumber}</Text> : null}
            {d.business.registrationNumber ? <Text style={s.muted}>Reg. no. {d.business.registrationNumber}</Text> : null}
          </View>
          <View>
            <Text style={s.title}>{title(d)}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>{d.number ?? "Draft"}</Text>
          </View>
        </View>

        <View style={[s.section, s.row]}>
          <View>
            <Text style={s.label}>For</Text>
            <Text style={s.bold}>{d.client.company ?? d.client.name}</Text>
            {d.client.company ? <Text>{d.client.name}</Text> : null}
            {d.client.companyVat ? <Text style={s.muted}>VAT no. {d.client.companyVat}</Text> : null}
            {d.client.address ? <Text style={s.muted}>{d.client.address}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text>
              <Text style={s.muted}>Date </Text>
              {formatDate(d.issueDate)}
            </Text>
            {d.dueDate ? (
              <Text>
                <Text style={s.muted}>{d.kind === "quote" ? "Valid until " : "Due "}</Text>
                {formatDate(d.dueDate)}
              </Text>
            ) : null}
            {d.sourceNumber ? (
              <Text>
                <Text style={s.muted}>{d.kind === "credit_note" ? "For invoice " : "From quote "}</Text>
                {d.sourceNumber}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ marginTop: 8 }}>
          <View style={s.row}>
            <Text style={[s.th, s.desc]}>Description</Text>
            <Text style={[s.th, s.num]}>Qty</Text>
            <Text style={[s.th, s.num]}>Price</Text>
            {showVat ? <Text style={[s.th, s.num]}>VAT</Text> : null}
            <Text style={[s.th, s.num]}>Amount</Text>
          </View>
          {d.lines.map((l, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={[s.td, s.desc]}>
                {l.description}
                {l.discountPct > 0 ? ` (${l.discountPct}% off)` : ""}
              </Text>
              <Text style={[s.td, s.num]}>{String(l.quantity).replace(".", ",")}</Text>
              <Text style={[s.td, s.num]}>{money(l.unitCents)}</Text>
              {showVat ? <Text style={[s.td, s.num]}>{l.vatRate}%</Text> : null}
              <Text style={[s.td, s.num]}>{money(showVat ? l.netCents : l.grossCents)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals}>
          {showVat ? (
            <>
              <View style={s.row}>
                <Text style={s.muted}>Subtotal</Text>
                <Text>{money(d.subtotalCents)}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.muted}>VAT</Text>
                <Text>{money(d.vatCents)}</Text>
              </View>
            </>
          ) : null}
          <View style={[s.row, { marginTop: 4 }]}>
            <Text style={s.bold}>Total</Text>
            <Text style={s.bold}>{money(d.totalCents)}</Text>
          </View>
          {d.depositCents > 0 && d.kind !== "credit_note" ? (
            <View style={s.row}>
              <Text style={s.muted}>Deposit due</Text>
              <Text>{money(d.depositCents)}</Text>
            </View>
          ) : null}
          {d.paidCents > 0 || d.creditedCents > 0 ? (
            <View style={[s.row, { marginTop: 4 }]}>
              <Text style={s.bold}>Balance</Text>
              <Text style={s.bold}>{money(balanceCents(d))}</Text>
            </View>
          ) : null}
        </View>

        {d.notes || bank ? (
          <View style={s.footer}>
            {d.notes ? <Text style={{ marginBottom: 10 }}>{d.notes}</Text> : null}
            {bank ? (
              <View>
                <Text style={s.label}>Pay by EFT</Text>
                {Object.entries(bank).map(([k, v]) => (
                  <Text key={k}>
                    <Text style={s.muted}>{k.replace(/_/g, " ")}: </Text>
                    {v}
                  </Text>
                ))}
                {d.number ? (
                  <Text>
                    <Text style={s.muted}>Reference: </Text>
                    <Text style={s.bold}>{d.number}</Text>
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
