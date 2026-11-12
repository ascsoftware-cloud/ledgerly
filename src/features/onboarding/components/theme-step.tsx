"use client";

import { Moon, Sun } from "lucide-react";
import { ACCENTS, type Accent } from "@/lib/theme/accents";
import { formatMoney } from "@/lib/money";

/** Question 7: accent and light/dark, with a live preview. The whole page recolours as you tap. */
export function ThemeStep({
  accent,
  mode,
  onAccent,
  onMode,
}: {
  accent: Accent;
  mode: "light" | "dark";
  onAccent: (accent: Accent) => void;
  onMode: (mode: "light" | "dark") => void;
}) {
  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label="Accent colour" className="grid grid-cols-6 gap-2">
        {(Object.keys(ACCENTS) as Accent[]).map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={accent === a}
            aria-label={ACCENTS[a].label}
            title={ACCENTS[a].label}
            data-accent={a}
            onClick={() => onAccent(a)}
            className="mx-auto size-12 rounded-full border-4 border-card bg-(--accent-c) shadow-card ring-2 ring-transparent transition-shadow duration-(--dur-fast) aria-checked:ring-foreground"
          />
        ))}
      </div>

      <div role="radiogroup" aria-label="Light or dark" className="grid grid-cols-2 gap-3">
        {(
          [
            ["light", "Light", Sun],
            ["dark", "Dark", Moon],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            aria-label={label}
            onClick={() => onMode(value)}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl border-2 bg-card font-semibold shadow-card transition-colors duration-(--dur-fast) aria-checked:border-primary aria-checked:bg-accent"
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <div aria-hidden className="rounded-2xl border bg-card p-4 shadow-raised">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Paid this month</p>
            <p className="text-2xl font-semibold tracking-tight">{formatMoney(1845000)}</p>
          </div>
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
            Paid
          </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-2/3 rounded-full bg-primary" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Two thirds of the way to your goal</p>
      </div>
    </div>
  );
}
