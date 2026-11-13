import { describe, expect, test } from "vitest";
import { ACTIONS, actionsFor, describeRule, ruleSchema, TRIGGERS, unitFor } from "./schema";

describe("what a rule can do", () => {
  test("an invoice or quote can email the client, notify you or make a task", () => {
    expect(actionsFor("invoice_overdue")).toEqual(["send_reminder", "notify_me", "create_task"]);
    expect(actionsFor("quote_unaccepted")).toEqual(["send_reminder", "notify_me", "create_task"]);
  });
  test("stock and bookings can notify you or make a task; a task can only notify you", () => {
    expect(actionsFor("stock_below")).toEqual(["notify_me", "create_task"]);
    expect(actionsFor("booking_soon")).toEqual(["notify_me", "create_task"]);
    expect(actionsFor("task_overdue")).toEqual(["notify_me"]);
  });
  test("every trigger and action has a plain-language label", () => {
    for (const t of Object.keys(TRIGGERS)) expect(TRIGGERS[t as keyof typeof TRIGGERS].label.length).toBeGreaterThan(5);
    for (const a of Object.keys(ACTIONS)) expect(ACTIONS[a as keyof typeof ACTIONS].length).toBeGreaterThan(5);
  });
  test("booking alerts count hours, stock needs no number, the rest count days", () => {
    expect(unitFor("booking_soon")).toBe("hours");
    expect(unitFor("stock_below")).toBeNull();
    expect(unitFor("invoice_overdue")).toBe("days");
  });
});

describe("ruleSchema", () => {
  const ok = { name: "Chase late invoices", trigger: "invoice_overdue", threshold: "3", action: "notify_me" };
  test("turns the form into a rule", () => {
    expect(ruleSchema.parse(ok)).toEqual({ name: "Chase late invoices", trigger: "invoice_overdue", threshold: 3, action: "notify_me" });
  });
  test("stock rules ignore the number", () => {
    expect(ruleSchema.parse({ name: "Low", trigger: "stock_below", threshold: "9", action: "notify_me" }).threshold).toBe(0);
  });
  test("zero days is allowed for overdue things, not for a booking alert", () => {
    expect(ruleSchema.safeParse({ ...ok, threshold: "0" }).success).toBe(true);
    expect(ruleSchema.safeParse({ name: "x", trigger: "booking_soon", threshold: "0", action: "notify_me" }).success).toBe(false);
  });
  test.each([
    [{ threshold: "-1" }, "days"],
    [{ threshold: "400" }, "days"],
    [{ threshold: "abc" }, "number"],
    [{ threshold: "1.5" }, "whole"],
    [{ name: "" }, "name"],
    [{ trigger: "task_overdue", action: "send_reminder" }, "can't"],
    [{ trigger: "nonsense" }, "when"],
    [{ action: "nonsense" }, "do"],
  ])("rejects %j", (patch, word) => {
    const r = ruleSchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message.toLowerCase()).toContain(word);
  });
  test("a booking alert is at most a week ahead", () => {
    expect(ruleSchema.safeParse({ name: "x", trigger: "booking_soon", threshold: "168", action: "notify_me" }).success).toBe(true);
    expect(ruleSchema.safeParse({ name: "x", trigger: "booking_soon", threshold: "169", action: "notify_me" }).success).toBe(false);
  });
});

describe("describeRule", () => {
  test.each([
    [{ trigger: "invoice_overdue", threshold: 3, action: "send_reminder" }, "When an invoice is 3 days overdue, email the client a reminder."],
    [{ trigger: "invoice_overdue", threshold: 1, action: "notify_me" }, "When an invoice is 1 day overdue, notify me."],
    [{ trigger: "invoice_overdue", threshold: 0, action: "create_task" }, "When an invoice is overdue, make a task."],
    [{ trigger: "quote_unaccepted", threshold: 7, action: "send_reminder" }, "When a quote has had no answer for 7 days, email the client a reminder."],
    [{ trigger: "stock_below", threshold: 0, action: "notify_me" }, "When a product falls to its re-order level, notify me."],
    [{ trigger: "booking_soon", threshold: 24, action: "notify_me" }, "When a booking is within 24 hours, notify me."],
    [{ trigger: "task_overdue", threshold: 2, action: "notify_me" }, "When a task is 2 days overdue, notify me."],
  ] as const)("%j", (rule, sentence) => expect(describeRule(rule)).toBe(sentence));
});
