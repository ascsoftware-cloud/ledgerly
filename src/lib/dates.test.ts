import { describe, expect, test } from "vitest";
import { formatDate, isOverdue, parseDateZA, todaySAST } from "./dates";

describe("todaySAST", () => {
  test("late evening UTC is already tomorrow in South Africa", () => {
    expect(todaySAST(new Date("2026-01-31T22:30:00Z"))).toBe("2026-02-01");
  });
  test("midday UTC is the same day", () => {
    expect(todaySAST(new Date("2026-06-15T12:00:00Z"))).toBe("2026-06-15");
  });
  test("rolls over the year", () => {
    expect(todaySAST(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
  });
});

describe("isOverdue", () => {
  test("not overdue on the due date itself, up to 23:59 SAST", () => {
    expect(isOverdue("2026-02-01", new Date("2026-02-01T21:59:00Z"))).toBe(false);
  });
  test("overdue from midnight SAST the next day", () => {
    expect(isOverdue("2026-02-01", new Date("2026-02-01T22:00:00Z"))).toBe(true);
  });
});

describe("parseDateZA", () => {
  test.each([
    ["31/01/2026", "2026-01-31"],
    ["2026-01-31", "2026-01-31"],
    ["31-01-26", "2026-01-31"],
    ["1/2/2026", "2026-02-01"],
    ["29/02/2028", "2028-02-29"],
    [" 05.03.2026 ", "2026-03-05"],
  ])("%j → %s", (input, iso) => {
    expect(parseDateZA(input)).toBe(iso);
  });

  test.each(["01/31/2026", "29/02/2026", "2026-13-01", "31/04/2026", "yesterday", "", "2026/01/31x"])(
    "%j is rejected",
    (input) => {
      expect(parseDateZA(input)).toBeNull();
    },
  );
});

describe("formatDate", () => {
  test("day, short month, year", () => {
    expect(formatDate("2026-01-31")).toBe("31 Jan 2026");
    expect(formatDate("2026-12-05")).toBe("5 Dec 2026");
  });
});
