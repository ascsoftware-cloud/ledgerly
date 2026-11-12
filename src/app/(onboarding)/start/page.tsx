import type { Metadata } from "next";
import { OnboardingFlow } from "@/features/onboarding/components/onboarding-flow";

export const metadata: Metadata = {
  title: "Set up your workspace",
  description: "Eight quick taps and your workspace is ready. Nothing to type.",
};

export default function StartPage() {
  return <OnboardingFlow />;
}
