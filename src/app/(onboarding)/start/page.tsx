import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { OnboardingFlow } from "@/features/onboarding/components/onboarding-flow";

export const metadata: Metadata = {
  title: "Set up your workspace",
  description: "Eight quick taps and your workspace is ready. Nothing to type.",
};

export default function StartPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-lg px-4 py-10">
          <PageSkeleton variant="list" />
        </main>
      }
    >
      <OnboardingFlow />
    </Suspense>
  );
}
