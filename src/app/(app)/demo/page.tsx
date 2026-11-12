import type { Metadata } from "next";
import { DemoShell } from "./demo-shell";

export const metadata: Metadata = { title: "Shell demo", robots: { index: false } };

export default function DemoPage() {
  return <DemoShell />;
}
