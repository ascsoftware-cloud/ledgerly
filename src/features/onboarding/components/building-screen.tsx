"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { ErrorState } from "@/components/states/error-state";
import { provisionWorkspace } from "../provision";
import { clearDraft, loadAnswers } from "../store";
import { Miko } from "./miko";

const STEPS = [
  "Saving your answers",
  "Switching on your tools",
  "Building your setup quest",
  "Applying your colours",
];

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Shown right after sign-in. The work is real (provision_workspace runs once, here);
 * the ticks pace themselves so the screen never flashes past, but the last one waits
 * for the database.
 */
export function BuildingScreen() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [ticked, setTicked] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Runs every time this screen becomes visible. Next.js keeps visited pages alive and
  // restores them, so a run-once guard would show a stale "All set" and do nothing.
  useEffect(() => {
    let cancelled = false;
    const storage = browserStorage();
    const answers = storage ? loadAnswers(storage) : null;
    let shown = 0;
    const timer = setInterval(
      () => {
        shown = Math.min(shown + 1, STEPS.length - 1);
        setTicked(shown);
      },
      reduceMotion ? 1 : 450,
    );
    let leave: ReturnType<typeof setTimeout> | undefined;

    provisionWorkspace(answers).then((res) => {
      clearInterval(timer);
      if (cancelled) return;
      if (!res.ok) {
        if (res.reason === "signed_out") router.replace("/login?next=%2Fwelcome");
        else setFailed(true);
        return;
      }
      setTicked(STEPS.length);
      if (storage) clearDraft(storage);
      leave = setTimeout(() => router.replace(`/${res.slug}`), reduceMotion ? 0 : 500);
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(leave);
      setTicked(0);
      setFailed(false);
    };
  }, [attempt, reduceMotion, router]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4">
      {failed ? (
        <ErrorState
          title="We couldn't finish setting up"
          body="Nothing was lost. Check your connection and try again."
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : (
        <>
          <Miko line={ticked >= STEPS.length ? "All set. Let's go!" : "Hang tight, I'm setting things up."} />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Building your workspace…</h1>
            <p className="text-muted-foreground">This only takes a moment.</p>
          </div>
          <ol className="space-y-3" aria-live="polite">
            {STEPS.map((label, i) => {
              const done = i < ticked;
              return (
                <li key={label} className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-card">
                  <span
                    className={`flex size-8 items-center justify-center rounded-full transition-colors duration-(--dur) ${done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {done ? (
                      <Check className="size-4" aria-hidden />
                    ) : (
                      <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                    )}
                  </span>
                  <span className={done ? "font-medium" : "text-muted-foreground"}>{label}</span>
                  <span className="sr-only">{done ? "done" : "in progress"}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}
