import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeControls } from "./theme-controls";

export const metadata: Metadata = { title: "Styleguide", robots: { index: false } };

const COLOURS = [
  ["Background", "bg-background"],
  ["Surface", "bg-card"],
  ["Accent", "bg-primary"],
  ["Accent tint", "bg-accent"],
  ["Muted", "bg-muted"],
  ["Success", "bg-success"],
  ["Warning", "bg-warning"],
  ["Danger", "bg-destructive"],
] as const;

const TYPE = [
  ["text-4xl", "36 · Page title"],
  ["text-3xl", "30 · Section title"],
  ["text-2xl", "24 · Card title"],
  ["text-xl", "20 · Subtitle"],
  ["text-lg", "18 · Lead"],
  ["text-base", "16 · Body"],
  ["text-sm", "14 · Secondary"],
  ["text-xs", "12 · Caption"],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function StyleguidePage() {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-12 px-4 py-10">
      <header className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Ledgerly styleguide</h1>
        <p className="text-muted-foreground">Tokens and components. Switch mode and accent to check both.</p>
        <ThemeControls />
      </header>

      <Section title="Colour">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLOURS.map(([name, cls]) => (
            <div key={name} className="space-y-2">
              <div className={`h-16 rounded-xl border ${cls}`} />
              <p className="text-sm">{name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="space-y-2">
          {TYPE.map(([cls, label]) => (
            <p key={cls} className={cls}>
              {label}
            </p>
          ))}
          <p className="text-muted-foreground">Muted text for secondary information.</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="touch">Send invoice</Button>
          <Button size="touch" variant="outline">
            Save draft
          </Button>
          <Button size="touch" variant="secondary">
            Secondary
          </Button>
          <Button size="touch" variant="ghost">
            Cancel
          </Button>
          <Button size="touch" variant="destructive">
            Delete
          </Button>
          <Button size="touch" disabled>
            Disabled
          </Button>
        </div>
      </Section>

      <Section title="Inputs and badges">
        <div className="flex max-w-sm flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="sg-email">
            Email
          </label>
          <Input id="sg-email" type="email" placeholder="you@business.co.za" className="h-11" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>Paid</Badge>
          <Badge variant="secondary">Draft</Badge>
          <Badge variant="outline">Sent</Badge>
          <Badge variant="destructive">Overdue</Badge>
        </div>
      </Section>

      <Section title="Cards, radius and shadow">
        <div className="grid gap-4 sm:grid-cols-3">
          {(["shadow-card", "shadow-raised", "shadow-overlay"] as const).map((s) => (
            <Card key={s} className={s}>
              <CardHeader>
                <CardTitle>R 12 450,00</CardTitle>
                <CardDescription>{s}</CardDescription>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
    </main>
  );
}
