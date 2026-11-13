import { describe, expect, test } from "vitest";
import { businessSchema } from "./schema";

const ok = { name: "Ayanda's Tiles", registration: "", vatRegistered: false, vatNumber: "" };

describe("businessSchema", () => {
  test("a name alone is enough, and is trimmed", () => {
    expect(businessSchema.parse({ ...ok, name: "  Ayanda's Tiles  " })).toEqual({ name: "Ayanda's Tiles", registration: "", vatRegistered: false, vatNumber: "" });
  });
  test.each([["", "Enter your business name."], ["   ", "Enter your business name."], ["x".repeat(81), "Keep the name under 80 characters."]])("name %j is refused: %s", (name, message) => {
    const r = businessSchema.safeParse({ ...ok, name });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe(message);
  });
  test("a registration number is optional and capped", () => {
    expect(businessSchema.safeParse({ ...ok, registration: "2020/123456/07" }).success).toBe(true);
    expect(businessSchema.safeParse({ ...ok, registration: "x".repeat(41) }).success).toBe(false);
  });
  test("VAT registered needs a South African VAT number: 10 digits starting with 4, spaces allowed", () => {
    expect(businessSchema.safeParse({ ...ok, vatRegistered: true, vatNumber: "" }).success).toBe(false);
    expect(businessSchema.safeParse({ ...ok, vatRegistered: true, vatNumber: "123" }).success).toBe(false);
    expect(businessSchema.safeParse({ ...ok, vatRegistered: true, vatNumber: "5123456789" }).success).toBe(false);
    const r = businessSchema.parse({ ...ok, vatRegistered: true, vatNumber: "4123 456 789" });
    expect(r.vatNumber).toBe("4123456789");
  });
  test("a VAT number is dropped when not VAT registered", () => {
    expect(businessSchema.parse({ ...ok, vatRegistered: false, vatNumber: "4123456789" }).vatNumber).toBe("");
  });
});
