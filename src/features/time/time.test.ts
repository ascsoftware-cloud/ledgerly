import { describe, expect, test } from "vitest";
import { elapsedLabel, formatMinutes, parseDuration, timeEntrySchema } from "./time";

describe("parseDuration (minutes from what people type)", () => {
  test.each([
    ["1:30", 90],
    ["0:45", 45],
    ["1,5", 90],
    ["1.25", 75],
    ["2", 120],
    ["2h", 120],
    ["90m", 90],
    ["1h 30m", 90],
    ["1 h 15 min", 75],
  ])("%s → %i minutes", (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes);
  });

  test.each(["", "abc", "0", "0:00", "25:00", "1:75", "-1"])("%j is not a usable duration", (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe("formatMinutes and the running timer", () => {
  test.each([
    [0, "0h 00m"],
    [5, "0h 05m"],
    [90, "1h 30m"],
    [600, "10h 00m"],
  ])("%i → %s", (m, label) => {
    expect(formatMinutes(m)).toBe(label);
  });

  test("a timer shows hours, minutes and seconds since it started", () => {
    expect(elapsedLabel("2026-11-12T08:00:00Z", new Date("2026-11-12T09:02:05Z"))).toBe("1:02:05");
  });
});

describe("timeEntrySchema (manual entries)", () => {
  const base = { date: "12/11/2026", duration: "1:30", description: " Tiling ", billable: "on", taskId: "", requestId: "0b8f8a2e-3c2a-4f4a-9f6a-2b1d1c0e9a11" };
  test("reads date and duration", () => {
    const r = timeEntrySchema.safeParse(base);
    expect(r.success && r.data).toMatchObject({ date: "2026-11-12", minutes: 90, description: "Tiling", billable: true, taskId: null });
  });
  test("not billable when unticked", () => {
    const r = timeEntrySchema.safeParse({ ...base, billable: undefined });
    expect(r.success && r.data.billable).toBe(false);
  });
  test.each([
    [{ duration: "nope" }, "How long"],
    [{ date: "31/02/2026" }, "Use a date like"],
    [{ date: "01/01/2099" }, "cannot be in the future"],
  ])("%j is refused", (patch, message) => {
    const r = timeEntrySchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain(message);
  });
});
