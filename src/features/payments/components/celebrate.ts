"use client";

/** A short burst of confetti for milestones. Skipped for people who prefer reduced motion. */
export async function celebrate() {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { default: confetti } = await import("canvas-confetti");
  void confetti({ particleCount: 120, spread: 75, origin: { y: 0.7 }, disableForReducedMotion: true });
}
