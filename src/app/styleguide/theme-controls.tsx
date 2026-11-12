"use client";

import { ACCENTS, type Accent, type Mode } from "@/lib/theme/accents";
import { useTheme } from "@/lib/theme/theme-provider";

const MODES: Mode[] = ["light", "dark", "system"];

export function ThemeControls() {
  const { accent, mode, setAccent, setMode } = useTheme();
  return (
    <div className="flex flex-wrap items-center gap-6">
      <fieldset className="flex items-center gap-2">
        <legend className="sr-only">Colour mode</legend>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className="h-11 rounded-xl border px-4 text-sm font-medium capitalize aria-pressed:border-primary aria-pressed:bg-accent"
          >
            {m}
          </button>
        ))}
      </fieldset>
      <fieldset className="flex items-center gap-2">
        <legend className="sr-only">Accent colour</legend>
        {(Object.keys(ACCENTS) as Accent[]).map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={accent === a}
            aria-label={ACCENTS[a].label}
            title={ACCENTS[a].label}
            onClick={() => setAccent(a)}
            data-accent={a}
            className="size-11 rounded-full border-2 border-transparent bg-(--accent-c) aria-pressed:border-foreground"
          />
        ))}
      </fieldset>
    </div>
  );
}
