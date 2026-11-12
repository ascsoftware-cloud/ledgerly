import { describe, expect, test } from "vitest";
import { draftSchema, parseQuantity } from "./schema";
import { balanceCents, effectiveStatus, sendErrorMessage } from "./status";

describe("parseQuantity", () => {
  test.each([
    ["1", 1],
    ["1,5", 1.5],
    ["2.25", 2.25],
    [" 3 ", 3],
    ["0,0001", 0.0001],
  ])("%j → %d", (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });
  test.each(["", "0", "-1", "abc", "1.00001", "1000001"])("%j is rejected", (input) => {
    expect(parseQuantity(input)).toBeNull();
  });
});

const line = { description: "Labour", quantity: "3", unitPrice: "R 33,33", discount: "", vat: "15" };

describe("draftSchema", () => {
  test("turns what people type into cents and numbers", () => {
    const r = draftSchema.parse({
      kind: "invoice",
      contactId: "8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e",
      dueDate: "31/01/2027",
      notes: "  Thanks!  ",
      depositType: "pct",
      depositValue: "50",
      lines: [line, { description: "Parts", quantity: "1", unitPrice: "9,99", discount: "10", vat: "15" }],
    });
    expect(r).toEqual({
      kind: "invoice",
      contactId: "8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e",
      dueDate: "2027-01-31",
      notes: "Thanks!",
      deposit: { type: "pct", value: 50 },
      lines: [
        { description: "Labour", quantity: 3, unitCents: 3333, discountPct: 0, vatRate: 15 },
        { description: "Parts", quantity: 1, unitCents: 999, discountPct: 10, vatRate: 15 },
      ],
    });
  });

  test("a fixed deposit is entered in rand and stored in cents", () => {
    const r = draftSchema.parse({
      kind: "quote",
      contactId: "8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e",
      depositType: "amount",
      depositValue: "1 500",
      lines: [line],
    });
    expect(r.deposit).toEqual({ type: "amount", value: 150000 });
  });

  test("blank rows are ignored, so a half-filled form still saves", () => {
    const r = draftSchema.parse({
      kind: "invoice",
      contactId: "8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e",
      lines: [line, { description: "", quantity: "", unitPrice: "", discount: "", vat: "0" }],
    });
    expect(r.lines).toHaveLength(1);
    expect(r.deposit).toBeNull();
  });

  test.each([
    [{ contactId: "" }, "contactId"],
    [{ lines: [{ ...line, unitPrice: "abc" }] }, "lines"],
    [{ lines: [{ ...line, quantity: "0" }] }, "lines"],
    [{ lines: [{ ...line, discount: "120" }] }, "lines"],
    [{ lines: [{ ...line, vat: "14" }] }, "lines"],
    [{ dueDate: "02/31/2027" }, "dueDate"],
    [{ depositType: "pct", depositValue: "150" }, "depositValue"],
  ])("rejects %j", (patch, path) => {
    const r = draftSchema.safeParse({
      kind: "invoice",
      contactId: "8e0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e",
      lines: [line],
      ...patch,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path[0]).toBe(path);
  });
});

describe("effectiveStatus", () => {
  const sent = { status: "sent" as const, dueDate: "2026-02-01" };
  test("a sent invoice is overdue from the day after it is due (SAST)", () => {
    expect(effectiveStatus(sent, new Date("2026-02-01T21:59:00Z"))).toBe("sent");
    expect(effectiveStatus(sent, new Date("2026-02-01T22:00:00Z"))).toBe("overdue");
  });
  test("viewed and part-paid invoices can be overdue too", () => {
    const late = new Date("2026-03-01T10:00:00Z");
    expect(effectiveStatus({ status: "viewed", dueDate: "2026-02-01" }, late)).toBe("overdue");
    expect(effectiveStatus({ status: "part_paid", dueDate: "2026-02-01" }, late)).toBe("overdue");
  });
  test("paid, void, draft and accepted never are", () => {
    const late = new Date("2027-01-01T10:00:00Z");
    for (const status of ["paid", "void", "draft", "accepted"] as const) {
      expect(effectiveStatus({ status, dueDate: "2026-02-01" }, late)).toBe(status);
    }
  });
});

describe("balanceCents", () => {
  test("total less payments and credits, never below zero", () => {
    expect(balanceCents({ totalCents: 10000, paidCents: 2500, creditedCents: 1000 })).toBe(6500);
    expect(balanceCents({ totalCents: 10000, paidCents: 9000, creditedCents: 2000 })).toBe(0);
  });
});

describe("sendErrorMessage", () => {
  test("explains the Free plan limit", () => {
    expect(sendErrorMessage({ code: "LDG01", message: "x" })).toMatch(/10 invoices and quotes/);
  });
  test("passes on the database's own explanation for rule breaks", () => {
    expect(sendErrorMessage({ code: "LDG03", message: "Add at least one line with an amount before sending" })).toBe(
      "Add at least one line with an amount before sending",
    );
  });
  test("hides anything unexpected behind a plain message", () => {
    expect(sendErrorMessage({ code: "XX000", message: "internal stack trace" })).toBe(
      "Couldn't send it. Try again in a moment.",
    );
  });
});
