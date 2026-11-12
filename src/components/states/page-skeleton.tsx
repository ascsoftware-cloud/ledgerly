import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder shown while a screen loads. Shapes match the real layout to avoid a jump. */
export function PageSkeleton({ variant }: { variant: "list" | "detail" | "dashboard" }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      {variant === "dashboard" && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      )}
      {variant === "detail" && (
        <>
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 rounded-2xl" />
        </>
      )}
      {(variant === "list" || variant === "dashboard") &&
        [0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
