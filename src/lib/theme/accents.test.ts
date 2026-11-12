import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ACCENTS, BASE, contrastRatio, type Accent } from "./accents";

const accents = Object.keys(ACCENTS) as Accent[];

describe("contrastRatio", () => {
  test("black on white is 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
  test("same colour is 1", () => {
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
  });
});

describe("accent colours meet WCAG AA", () => {
  test("there are six accents", () => {
    expect(accents).toEqual(["emerald", "indigo", "coral", "amber", "violet", "sky"]);
  });

  test.each(accents)("%s: text on the accent is readable in light mode", (a) => {
    expect(contrastRatio(ACCENTS[a].onAccentLight, ACCENTS[a].light)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(accents)("%s: text on the accent is readable in dark mode", (a) => {
    expect(contrastRatio(ACCENTS[a].onAccentDark, ACCENTS[a].dark)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(accents)("%s: accent used as link text is readable on the page", (a) => {
    expect(contrastRatio(ACCENTS[a].light, BASE.light.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ACCENTS[a].dark, BASE.dark.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("base colours meet WCAG AA", () => {
  test.each(["light", "dark"] as const)("%s: text and muted text on bg and surface", (mode) => {
    const b = BASE[mode];
    for (const fg of [b.text, b.muted]) {
      for (const bg of [b.bg, b.surface]) {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("tokens.css stays in sync with accents.ts", () => {
  const css = readFileSync("src/styles/tokens.css", "utf8").toLowerCase();
  test.each(accents)("%s colours appear in the stylesheet", (a) => {
    const c = ACCENTS[a];
    for (const hex of [c.light, c.dark, c.onAccentLight, c.onAccentDark]) {
      expect(css).toContain(hex.toLowerCase());
    }
  });
  test("base colours appear in the stylesheet", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const hex of Object.values(BASE[mode])) expect(css).toContain(hex.toLowerCase());
    }
  });
});
