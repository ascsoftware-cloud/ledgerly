import { describe, expect, test } from "vitest";
import { bookingSchema, buildIcs, slotLabel, whenLabel } from "./booking";

describe("buildIcs (RFC 5545)", () => {
  const ics = buildIcs({
    uid: "b1f0c3e2@ledgerly",
    startsAt: "2026-11-20T08:00:00.000Z",
    endsAt: "2026-11-20T08:45:00.000Z",
    stamp: "2026-11-12T10:00:00.000Z",
    summary: "Haircut, colour; wash with Thandi's Salon",
    description: "Line one\nLine two, with a comma",
  });

  test("is a calendar with one event, CRLF line endings throughout", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  test("times are UTC", () => {
    expect(ics).toContain("\r\nDTSTART:20261120T080000Z\r\n");
    expect(ics).toContain("\r\nDTEND:20261120T084500Z\r\n");
    expect(ics).toContain("\r\nDTSTAMP:20261112T100000Z\r\n");
    expect(ics).toContain("\r\nUID:b1f0c3e2@ledgerly\r\n");
  });

  test("commas, semicolons, backslashes and newlines are escaped", () => {
    expect(ics).toContain("SUMMARY:Haircut\\, colour\\; wash with Thandi's Salon");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two\\, with a comma");
  });

  test("long lines are folded at 75 octets with a leading space", () => {
    const long = buildIcs({ uid: "x", startsAt: "2026-11-20T08:00:00Z", endsAt: "2026-11-20T09:00:00Z", stamp: "2026-11-12T10:00:00Z", summary: "é".repeat(60), description: "" });
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(long).toContain("\r\n ");
  });
});

describe("SAST labels", () => {
  test("a booking time reads in South African time", () => {
    expect(whenLabel("2026-11-20T08:00:00.000Z")).toBe("Fri 20 Nov 2026, 10:00");
  });
  test("slot labels are 24-hour SAST", () => {
    expect(slotLabel("2026-11-20T06:30:00Z")).toBe("08:30");
  });
});

describe("bookingSchema", () => {
  const base = { name: " Thandi Mokoena ", email: " Thandi@Example.com ", phone: "082 123 4567", notes: "", startsAt: "2026-11-20T08:00:00.000Z", serviceId: "0b8f8a2e-3c2a-4f4a-9f6a-2b1d1c0e9a11" };
  test("tidies the details", () => {
    const r = bookingSchema.safeParse(base);
    expect(r.success && r.data).toMatchObject({ name: "Thandi Mokoena", email: "thandi@example.com", phone: "+27821234567" });
  });
  test("phone is optional", () => {
    const r = bookingSchema.safeParse({ ...base, phone: "" });
    expect(r.success && r.data.phone).toBeNull();
  });
  test.each([
    [{ name: "T" }, "Type your name"],
    [{ email: "nope" }, "email address"],
    [{ phone: "123" }, "phone number"],
    [{ startsAt: "tomorrow" }, "Choose a time"],
  ])("%j is refused", (patch, message) => {
    const r = bookingSchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain(message);
  });
});
