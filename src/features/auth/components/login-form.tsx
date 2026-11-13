"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeNext } from "@/lib/safe-next";
import { requestEmailCode, verifyEmailCode, type CodeState, type EmailState } from "../actions";
import { GoogleButton } from "./google-button";

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Send yourself a new one.",
  google: "Google sign-in didn't work. Try again, or use your email.",
  "google-off": "Google sign-in isn't switched on yet. Use your email for now.",
  busy: "Too many attempts. Wait a few minutes, then try again.",
};

const RESEND_SECONDS = 60;

export function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const fromOnboarding = params.get("next") === "/welcome";
  const urlError = ERRORS[params.get("error") ?? ""];

  const [emailState, sendCode, sending] = useActionState<EmailState, FormData>(requestEmailCode, {
    status: "idle",
  });
  const [codeState, checkCode, checking] = useActionState<CodeState, FormData>(verifyEmailCode, {
    status: "idle",
  });
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement>(null);

  const sentTo = !editing && emailState.status === "sent" ? emailState.email : null;
  // Seconds until another code may be requested. Clamped, so a wrong device clock can't lock anyone out.
  const cooldown =
    emailState.status === "sent"
      ? Math.min(RESEND_SECONDS, Math.max(0, Math.ceil(RESEND_SECONDS - (now - emailState.sentAt) / 1000)))
      : 0;

  useEffect(() => {
    if (!sentTo) return;
    codeRef.current?.focus();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sentTo]);

  if (sentTo) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-muted-foreground">
            We sent a sign-in link and a 6-digit code to <strong className="text-foreground">{sentTo}</strong>.
            Tap the link, or type the code here.
          </p>
        </div>

        <form action={checkCode} className="space-y-3">
          <input type="hidden" name="email" value={sentTo} />
          <input type="hidden" name="next" value={next} />
          <label htmlFor="code" className="text-sm font-medium">
            6-digit code
          </label>
          <Input
            ref={codeRef}
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            required
            aria-invalid={codeState.status === "error"}
            aria-describedby={codeState.status === "error" ? "code-error" : undefined}
            className="h-14 text-center text-2xl tracking-[0.4em]"
          />
          {codeState.status === "error" && (
            <p id="code-error" role="alert" className="text-sm text-destructive">
              {codeState.message}
            </p>
          )}
          <Button type="submit" size="touch" className="h-14 w-full" disabled={checking}>
            {checking ? "Checking…" : "Sign in"}
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="h-11 text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Use a different email
          </button>
          <form action={sendCode}>
            <input type="hidden" name="email" value={sentTo} />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              disabled={cooldown > 0 || sending}
              className="h-11 text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:no-underline disabled:opacity-60"
            >
              {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const emailError = emailState.status === "error" ? emailState.message : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {fromOnboarding ? "Save your workspace" : "Sign in to Ledgerly"}
        </h1>
        <p className="text-muted-foreground">No password, ever. New here? This creates your account.</p>
      </div>

      {urlError && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          {urlError}
        </p>
      )}

      <GoogleButton next={next} />

      <div className="flex items-center gap-3 text-sm text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <form
        action={(form) => {
          setEditing(false);
          sendCode(form);
        }}
        className="space-y-3"
      >
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@business.co.za"
          required
          autoFocus={params.get("method") === "email"}
          defaultValue={emailState.status === "error" ? (emailState.email ?? "") : ""}
          aria-invalid={!!emailError}
          aria-describedby={emailError ? "email-error" : undefined}
          className="h-14 text-base"
        />
        {emailError && (
          <p id="email-error" role="alert" className="text-sm text-destructive">
            {emailError}
          </p>
        )}
        <Button type="submit" size="touch" className="h-14 w-full" disabled={sending}>
          <Mail className="size-5" aria-hidden />
          {sending ? "Sending…" : "Email me a code"}
        </Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        By continuing you agree to the{" "}
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>{" "}
        and the{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy policy
        </Link>
        . We use your email only to sign you in and to send what you ask for.
      </p>
    </div>
  );
}
