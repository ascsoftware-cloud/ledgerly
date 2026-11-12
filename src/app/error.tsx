"use client";

import { ErrorState } from "@/components/states/error-state";

export default function RouteError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-md">
        <ErrorState
          title="Something went wrong"
          body="It's us, not you. Your data is safe. Try again in a moment."
          onRetry={retry}
        />
      </div>
    </main>
  );
}
