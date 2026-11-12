import type { Metadata } from "next";
import { BuildingScreen } from "@/features/onboarding/components/building-screen";

export const metadata: Metadata = { title: "Building your workspace", robots: { index: false } };

export default function WelcomePage() {
  return <BuildingScreen />;
}
