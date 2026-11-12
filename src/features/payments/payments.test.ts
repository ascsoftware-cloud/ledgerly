import { describe, expect, test } from "vitest";
import { bankDetailsSchema, manualPaymentSchema, payfastSchema, yocoSchema } from "./schema";

describe("bank details", () => {
  test("tidies spaces and dashes in numbers", () => {
    expect(
      bankDetailsSchema.parse({
        bank: "FNB",
        account_holder: " Alice Tiling ",
        account_number: "6200 0000-000",
        branch_code: "250 655",
        account_type: "Business",
      }),
    ).toEqual({ bank: "FNB", account_holder: "Alice Tiling", account_number: "62000000000", branch_code: "250655", account_type: "Business" });
  });
  test.each([
    [{ account_number: "12345" }, "account_number"],
    [{ branch_code: "25065" }, "branch_code"],
    [{ bank: "Bank of Nowhere" }, "bank"],
  ])("rejects %j", (patch, field) => {
    const r = bankDetailsSchema.safeParse({
      bank: "FNB",
      account_holder: "A",
      account_number: "62000000000",
      branch_code: "250655",
      account_type: "Cheque",
      ...patch,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toContain(field);
  });
});

describe("provider keys", () => {
  test("Yoco wants the secret key, not the public one", () => {
    expect(yocoSchema.safeParse({ secretKey: "sk_test_abcdefghijklmnop" }).success).toBe(true);
    expect(yocoSchema.safeParse({ secretKey: "pk_test_abcdefghijklmnop" }).success).toBe(false);
  });
  test("PayFast needs a numeric merchant ID and a key", () => {
    expect(payfastSchema.parse({ merchantId: " 10000100 ", merchantKey: "46f0cd694581a", mode: "test" })).toEqual({
      merchantId: "10000100",
      merchantKey: "46f0cd694581a",
      passphrase: "",
      mode: "test",
    });
    expect(payfastSchema.safeParse({ merchantId: "abc", merchantKey: "46f0cd694581a", mode: "test" }).success).toBe(false);
  });
});

describe("recording a payment", () => {
  const base = { amount: "1 500", method: "eft", reference: "FNB 123", requestId: "8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e" };
  test("amount in rand becomes cents; no date means today", () => {
    const r = manualPaymentSchema.parse(base);
    expect(r.amount).toBe(150000);
    expect(r.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  test.each([
    [{ amount: "0" }, "amount"],
    [{ amount: "lots" }, "amount"],
    [{ paidOn: "31/12/2999" }, "paidOn"],
    [{ method: "yoco" }, "method"],
  ])("rejects %j", (patch, field) => {
    const r = manualPaymentSchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path[0]).toBe(field);
  });
});
