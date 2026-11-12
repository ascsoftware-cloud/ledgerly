import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

type Action = { label: string } & ({ href: string } | { onClick: () => void });

/** Shown instead of a blank list. Always offers exactly one next step. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action: Action;
}) {
  const cls = buttonVariants({ size: "touch" });
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent text-primary">
        <Icon className="size-7" aria-hidden />
      </span>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
      {"href" in action ? (
        <Link href={action.href} className={cls}>
          {action.label}
        </Link>
      ) : (
        <button type="button" onClick={action.onClick} className={cls}>
          {action.label}
        </button>
      )}
    </div>
  );
}
