/**
 * Tiny tap feedback for onboarding: a soft blip and a short vibration.
 * Both are opt-in, and both stay silent for people who prefer reduced motion.
 */

export const SOUND_KEY = "ledgerly-sound";
export const HAPTICS_KEY = "ledgerly-haptics";

let audio: AudioContext | null = null;

function calm(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function playTap(enabled: boolean, kind: "select" | "next" = "select") {
  if (!enabled || calm()) return;
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = kind === "next" ? 660 : 520;
    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.12);
  } catch {
    // Audio unavailable: stay silent.
  }
}

export function buzz(enabled: boolean) {
  if (!enabled || calm()) return;
  try {
    navigator.vibrate?.(10);
  } catch {
    // Vibration unsupported (e.g. iOS Safari): nothing to do.
  }
}
