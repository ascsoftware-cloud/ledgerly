"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Vibrate, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { isAccent, type Accent } from "@/lib/theme/accents";
import { useTheme } from "@/lib/theme/theme-provider";
import { useStoredFlag } from "@/lib/use-stored-flag";
import { HAPTICS_KEY, SOUND_KEY, buzz, playTap } from "../feedback";
import { QUESTIONS, type OptionValue, type Question, type Selection } from "../questions";
import type { PartialAnswers } from "../schema";
import type { Draft } from "../store";
import { useDraft } from "../use-draft";
import { Miko } from "./miko";
import { OptionCard } from "./option-card";
import { SaveStep } from "./save-step";
import { ThemeStep } from "./theme-step";

const TOTAL = QUESTIONS.length + 1; // eight questions plus the save screen

function currentMode(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function selectionFor(q: Question, answers: PartialAnswers): Selection | undefined {
  if (q.id === "vibe") return answers.accent;
  return answers[q.id] as Selection | undefined;
}

/** Applies a tap to the draft's answers for one question. */
function applyTap(q: Question, answers: PartialAnswers, value: OptionValue): PartialAnswers {
  if (q.id === "vibe") return answers;
  if (q.kind === "single") return { ...answers, [q.id]: value };

  const current = (answers[q.id] as OptionValue[] | undefined) ?? [];
  const exclusive = q.exclusive ?? [];
  let next: OptionValue[];
  if (current.includes(value)) next = current.filter((v) => v !== value);
  else if (exclusive.includes(value)) next = [value];
  else next = [...current.filter((v) => !exclusive.includes(v)), value];

  const rest: Record<string, unknown> = { ...answers };
  if (next.length === 0) delete rest[q.id];
  else rest[q.id] = next;
  return rest as PartialAnswers;
}

export function OnboardingFlow() {
  const [draft, update] = useDraft();
  const { accent, setAccent, setMode } = useTheme();
  const [sound, setSound] = useStoredFlag(SOUND_KEY, false);
  const [haptics, setHaptics] = useStoredFlag(HAPTICS_KEY, true);
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  // Signed-in users finishing set-up later skip the sign-in screen and go straight to building.
  const resumeAfter = useSearchParams().get("then") === "welcome";
  const [direction, setDirection] = useState<1 | -1>(1);

  if (!draft) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-10">
        <PageSkeleton variant="list" />
      </main>
    );
  }

  const step = draft.step;
  const question = QUESTIONS[step];
  const selection = question ? selectionFor(question, draft.answers) : undefined;
  const chosenAccent: Accent = isAccent(draft.answers.accent) ? draft.answers.accent : accent;
  const chosenMode = draft.answers.mode ?? currentMode();

  const canContinue =
    !!question &&
    (question.kind === "theme" ||
      (Array.isArray(selection) ? selection.length > 0 : selection !== undefined));

  function tap(value: OptionValue) {
    if (!question) return;
    playTap(sound);
    buzz(haptics);
    update((d) => ({ ...d, answers: applyTap(question, d.answers, value) }));
  }

  function go(delta: 1 | -1) {
    setDirection(delta);
    if (delta === 1) playTap(sound, "next");
    update((d: Draft) => {
      const answers =
        delta === 1 && question?.kind === "theme"
          ? { ...d.answers, accent: chosenAccent, mode: chosenMode }
          : d.answers;
      return { ...d, answers, step: Math.min(Math.max(d.step + delta, 0), QUESTIONS.length) };
    });
    if (delta === 1 && resumeAfter && step === QUESTIONS.length - 1) router.push("/welcome");
  }

  const title = question ? question.title : "Save your workspace";
  const subtitle = question ? question.subtitle : "Sign in so your answers and your work are kept safe.";
  const line = !question
    ? "Last step. No password, ever."
    : selection !== undefined || question.kind === "theme"
      ? question.react(selection ?? "")
      : step === 0
        ? "Hi, I'm Miko. Tap what fits."
        : "Take your pick.";

  const slide = reduceMotion ? 0 : 32 * direction;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4">
      <header className="flex h-16 shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Back"
          hidden={step === 0}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <div
          role="progressbar"
          aria-label="Set-up progress"
          aria-valuemin={1}
          aria-valuemax={TOTAL}
          aria-valuenow={step + 1}
          className="h-3 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-(--dur-slow) ease-(--ease)"
            style={{ width: `${((step + 1) / TOTAL) * 100}%` }}
          />
        </div>
        <button
          type="button"
          aria-label="Sound"
          aria-pressed={sound}
          onClick={() => setSound(!sound)}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted aria-pressed:text-primary"
        >
          {sound ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
        </button>
        <button
          type="button"
          aria-label="Vibration"
          aria-pressed={haptics}
          onClick={() => setHaptics(!haptics)}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted aria-pressed:text-primary"
        >
          <Vibrate className="size-5" aria-hidden />
        </button>
      </header>

      <main className="flex-1 pt-2 pb-28">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: slide }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -slide }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="space-y-6"
          >
            <Miko line={line} />
            <div className="space-y-1">
              <h1 id="question" className="text-2xl font-semibold tracking-tight text-balance">
                {title}
              </h1>
              {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
            </div>

            {!question && <SaveStep />}

            {question?.kind === "theme" && (
              <ThemeStep
                accent={chosenAccent}
                mode={chosenMode}
                onAccent={(a) => {
                  playTap(sound);
                  buzz(haptics);
                  setAccent(a);
                  update((d) => ({ ...d, answers: { ...d.answers, accent: a } }));
                }}
                onMode={(m) => {
                  playTap(sound);
                  buzz(haptics);
                  setMode(m);
                  update((d) => ({ ...d, answers: { ...d.answers, mode: m } }));
                }}
              />
            )}

            {question && question.kind !== "theme" && (
              <div
                role={question.kind === "single" ? "radiogroup" : "group"}
                aria-labelledby="question"
                className="grid gap-3"
              >
                {question.options.map((o) => (
                  <OptionCard
                    key={o.value}
                    role={question.kind === "single" ? "radio" : "checkbox"}
                    checked={Array.isArray(selection) ? selection.includes(o.value) : selection === o.value}
                    label={o.label}
                    hint={o.hint}
                    icon={o.icon}
                    onSelect={() => tap(o.value)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {question && (
        <footer className="fixed inset-x-0 bottom-0 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto w-full max-w-lg px-4 py-3">
            <Button size="touch" className="h-13 w-full" disabled={!canContinue} onClick={() => go(1)}>
              Continue
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
