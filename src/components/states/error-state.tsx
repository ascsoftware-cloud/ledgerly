"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shown when a screen's data failed to load. */
export function ErrorState({
  title = "Couldn't load this",
  body = "Check your connection and try again.",
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-12 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-7" aria-hidden />
      </span>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
      <Button size="touch" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
