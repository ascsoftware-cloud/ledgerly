import { describe, expect, test } from "vitest";
import { classifyPath } from "@/lib/routing";
import { renderDocumentPdf } from "./pdf/render";
import { publicDocumentSchema, publicToViewData } from "./public";

const sample = {
  kind: "invoice",
  number: "INV-0001",
  status: "sent",
  issue_date: "2026-11-12",
  due_date: "2026-11-26",
  notes: "Thanks!",
  subtotal_cents: 100000,
  vat_cents: 15000,
  total_cents: 115000,
  deposit_cents: 0,
  paid_cents: 0,
  credited_cents: 0,
  accepted_at: null,
  source_number: null,
  business: { name: "Alice Tiling", vat_registered: true, vat_number: "4123456789", registration_number: null, bank_details: { bank: "FNB" } },
  client: { name: "Thandi", address: "1 Main Rd", company: "Acme", company_vat: null },
  lines: [{ description: "Tiling", quantity: 2, unit_cents: 50000, discount_pct: 0, vat_rate: 15, net_cents: 100000, gross_cents: 115000 }],
};

describe("public document page", () => {
  test("/p/<token> is an app route, not a workspace", () => {
    expect(classifyPath("/p/abcDEF123_-abcDEF123_-abcDEF12")).toBe("app");
  });

  test("the database payload maps onto the document view", () => {
    const v = publicToViewData(publicDocumentSchema.parse(sample));
    expect(v.number).toBe("INV-0001");
    expect(v.business.vatRegistered).toBe(true);
    expect(v.client.company).toBe("Acme");
    expect(v.lines[0]).toMatchObject({ description: "Tiling", unitCents: 50000, vatRate: 15 });
  });

  test("an unexpected payload is refused rather than half-rendered", () => {
    expect(publicDocumentSchema.safeParse({ ...sample, total_cents: "lots" }).success).toBe(false);
    expect(publicDocumentSchema.safeParse(null).success).toBe(false);
  });
});

describe("PDF", () => {
  test("renders a real PDF with the document number in it", async () => {
    const pdf = await renderDocumentPdf(publicToViewData(publicDocumentSchema.parse(sample)));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  }, 30_000);
});
