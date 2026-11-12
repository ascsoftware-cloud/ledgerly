"use client";

import { useEffect } from "react";
import type { Accent } from "@/lib/theme/accents";
import { useTheme } from "@/lib/theme/theme-provider";
import { ACCENT_KEY, THEME_KEY } from "@/lib/theme/theme-script";

/**
 * On a device that has never chosen colours, use the ones picked during onboarding
 * (saved on the workspace). A choice already made on this device always wins.
 */
export function WorkspaceTheme({ accent, mode }: { accent: Accent; mode: "light" | "dark" }) {
  const { setAccent, setMode } = useTheme();
  useEffect(() => {
    try {
      if (!localStorage.getItem(ACCENT_KEY)) setAccent(accent);
      if (!localStorage.getItem(THEME_KEY)) setMode(mode);
    } catch {
      // Storage blocked: keep the defaults.
    }
  }, [accent, mode, setAccent, setMode]);
  return null;
}
