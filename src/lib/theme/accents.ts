export type Accent = "emerald" | "indigo" | "coral" | "amber" | "violet" | "sky";
export type Mode = "light" | "dark" | "system";

type AccentDef = {
  label: string;
  /** Accent colour on light backgrounds. */
  light: string;
  /** Accent colour on dark backgrounds. */
  dark: string;
  /** Text colour placed on top of `light`. */
  onAccentLight: string;
  /** Text colour placed on top of `dark`. */
  onAccentDark: string;
};

export const ACCENTS: Record<Accent, AccentDef> = {
  emerald: { label: "Emerald", light: "#047857", dark: "#34d399", onAccentLight: "#ffffff", onAccentDark: "#04271c" },
  indigo: { label: "Indigo", light: "#4f46e5", dark: "#a5b4fc", onAccentLight: "#ffffff", onAccentDark: "#11123a" },
  coral: { label: "Coral", light: "#c2352a", dark: "#fb8a7a", onAccentLight: "#ffffff", onAccentDark: "#3a0d08" },
  amber: { label: "Amber", light: "#a8500a", dark: "#fbbf24", onAccentLight: "#ffffff", onAccentDark: "#2b1a00" },
  violet: { label: "Violet", light: "#7c3aed", dark: "#b9a3fb", onAccentLight: "#ffffff", onAccentDark: "#1d1040" },
  sky: { label: "Sky", light: "#0369a1", dark: "#38bdf8", onAccentLight: "#ffffff", onAccentDark: "#04273a" },
};

export const DEFAULT_ACCENT: Accent = "emerald";

export const BASE = {
  light: { bg: "#f7f8fa", surface: "#ffffff", text: "#0f172a", muted: "#566176", border: "#e2e6ec" },
  dark: { bg: "#0b1120", surface: "#141d2f", text: "#e8edf5", muted: "#9ba8bd", border: "#263249" },
} as const;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function isAccent(v: unknown): v is Accent {
  return typeof v === "string" && v in ACCENTS;
}
