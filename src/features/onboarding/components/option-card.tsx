import { Check, type LucideIcon } from "lucide-react";

/** One big tappable answer. Behaves as a radio (single) or checkbox (multi). */
export function OptionCard({
  role,
  checked,
  label,
  hint,
  icon: Icon,
  onSelect,
}: {
  role: "radio" | "checkbox";
  checked: boolean;
  label: string;
  hint?: string;
  icon: LucideIcon;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      aria-label={label}
      onClick={onSelect}
      className="group flex min-h-16 w-full items-center gap-4 rounded-2xl border-2 bg-card px-4 py-3 text-left shadow-card transition-[border-color,background-color,transform] duration-(--dur-fast) active:scale-[0.98] aria-checked:border-primary aria-checked:bg-accent"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors duration-(--dur-fast) group-aria-checked:bg-primary group-aria-checked:text-primary-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-sm text-muted-foreground">{hint}</span>}
      </span>
      <span
        aria-hidden
        className={`flex size-6 shrink-0 items-center justify-center border-2 text-primary-foreground transition-colors duration-(--dur-fast) group-aria-checked:border-primary group-aria-checked:bg-primary ${role === "radio" ? "rounded-full" : "rounded-md"}`}
      >
        <Check className="size-4 opacity-0 group-aria-checked:opacity-100" />
      </span>
    </button>
  );
}
