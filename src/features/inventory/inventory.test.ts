import { describe, expect, test } from "vitest";
import { adjustSchema, formatQty, lowStock, parseSignedQuantity, productSchema, stockState, supplierSchema } from "./schema";

describe("formatQty", () => {
  test.each([
    [12, "12"],
    [2.5, "2,5"],
    [-3, "-3"],
    [0.3333, "0,3333"],
    [4.0, "4"],
  ])("%s → %s", (n, want) => expect(formatQty(n)).toBe(want));
});

describe("parseSignedQuantity", () => {
  test.each([
    ["5", 5],
    ["+5", 5],
    ["-3", -3],
    ["−3", -3], // typographic minus from a phone keyboard
    ["2,5", 2.5],
    ["-0.25", -0.25],
  ])("%s → %s", (input, want) => expect(parseSignedQuantity(input)).toBe(want));

  test.each(["", "0", "-0", "abc", "1,2,3", "1.23456", "2000000", "5 apples"])("rejects %j", (input) =>
    expect(parseSignedQuantity(input)).toBeNull(),
  );
});

describe("stockState", () => {
  const p = (stockQty: number, reorderLevel = 0, trackStock = true) => ({ trackStock, stockQty, reorderLevel });
  test("untracked products have no stock state", () => expect(stockState(p(0, 0, false))).toBe("untracked"));
  test("below zero is oversold", () => expect(stockState(p(-2, 5))).toBe("oversold"));
  test("zero is out", () => expect(stockState(p(0, 5))).toBe("out"));
  test("at or under the reorder level is low", () => {
    expect(stockState(p(5, 5))).toBe("low");
    expect(stockState(p(3, 5))).toBe("low");
  });
  test("above the level is fine, and no level means never low", () => {
    expect(stockState(p(6, 5))).toBe("ok");
    expect(stockState(p(1, 0))).toBe("ok");
  });
});

describe("lowStock", () => {
  test("lists tracked products that need re-ordering, most urgent first", () => {
    const list = [
      { id: "a", name: "Tile", trackStock: true, stockQty: 4, reorderLevel: 5 },
      { id: "b", name: "Grout", trackStock: true, stockQty: -1, reorderLevel: 5 },
      { id: "c", name: "Paint", trackStock: true, stockQty: 50, reorderLevel: 5 },
      { id: "d", name: "Labour", trackStock: false, stockQty: 0, reorderLevel: 0 },
    ];
    expect(lowStock(list).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("productSchema", () => {
  const ok = { name: " Floor tile ", sku: "TILE-1", kind: "product", cost: "60", price: "R 95,00", vat: "15", trackStock: "on", reorderLevel: "5", supplierId: "", openingStock: "10" };

  test("turns a form into cents and numbers", () => {
    const r = productSchema.parse(ok);
    expect(r).toMatchObject({ name: "Floor tile", sku: "TILE-1", kind: "product", costCents: 6000, priceCents: 9500, vatRate: 15, trackStock: true, reorderLevel: 5, supplierId: null, openingStock: 10 });
  });
  test("a service never tracks stock", () => {
    const r = productSchema.parse({ ...ok, kind: "service", trackStock: "on", openingStock: "10" });
    expect(r.trackStock).toBe(false);
    expect(r.openingStock).toBeNull();
  });
  test("blank sku, cost, price and levels are allowed", () => {
    const r = productSchema.parse({ name: "Consulting", kind: "service" });
    expect(r).toMatchObject({ sku: null, costCents: 0, priceCents: 0, vatRate: 0, reorderLevel: 0 });
  });
  test.each([
    [{ name: "" }, "Name"],
    [{ price: "abc" }, "price"],
    [{ cost: "-5" }, "cost"],
    [{ vat: "10" }, "VAT"],
    [{ reorderLevel: "x" }, "re-order"],
    [{ openingStock: "-4" }, "opening"],
    [{ supplierId: "nope" }, "supplier"],
  ])("rejects %j", (patch, word) => {
    const r = productSchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message.toLowerCase()).toContain(word.toLowerCase());
  });
});

describe("supplierSchema", () => {
  test("name is required, email optional but valid", () => {
    expect(supplierSchema.safeParse({ name: "BW" }).success).toBe(true);
    expect(supplierSchema.safeParse({ name: "" }).success).toBe(false);
    expect(supplierSchema.safeParse({ name: "BW", email: "nope" }).success).toBe(false);
    expect(supplierSchema.parse({ name: "BW", email: " Orders@BW.co.za " }).email).toBe("orders@bw.co.za");
  });
});

describe("adjustSchema", () => {
  test("a signed non-zero number with an optional note", () => {
    expect(adjustSchema.parse({ change: "-3", note: " broken " })).toEqual({ change: -3, note: "broken" });
    expect(adjustSchema.safeParse({ change: "0" }).success).toBe(false);
    expect(adjustSchema.safeParse({ change: "" }).success).toBe(false);
  });
});
