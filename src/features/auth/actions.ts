"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { rateLimit } from "@/lib/rate-limit";
import { safeNext } from "@/lib/safe-next";
import { siteUrl } from "@/lib/site-url";
import { publicEnv } from "@/lib/supabase/env";
import { createServerClient } from "@/lib/supabase/server";
import { codeSchema, emailSchema } from "./schema";

export type EmailState =
  | { status: "idle" }
  | { status: "sent"; email: string; sentAt: number }
  | { status: "error"; message: string; email?: string };

export type CodeState = { status: "idle" } | { status: "error"; message: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

/** Step 1 of email sign-in: send one email with both a link and a 6-digit code. */
export async function requestEmailCode(_prev: EmailState, form: FormData): Promise<EmailState> {
  const parsed = emailSchema.safeParse(field(form, "email"));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid email address." };
  }
  const email = parsed.data;
  const next = safeNext(field(form, "next"));

  const [byEmail, byIp] = await Promise.all([
    rateLimit("otp-email", email, 3, 600),
    rateLimit("otp-ip", await clientIp(), 10, 3600),
  ]);
  if (!byEmail || !byIp) {
    return { status: "error", email, message: "Too many codes requested. Wait a few minutes, then try again." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    console.error("Sign-in email failed", { status: error.status, code: error.code });
    return {
      status: "error",
      email,
      message:
        error.status === 429
          ? "Too many emails sent. Wait a minute, then try again."
          : "We couldn't send the email. Check the address, or try again in a minute.",
    };
  }
  return { status: "sent", email, sentAt: Date.now() };
}

/** Step 2 of email sign-in: the 6-digit code, typed on the same device. */
export async function verifyEmailCode(_prev: CodeState, form: FormData): Promise<CodeState> {
  const email = emailSchema.safeParse(field(form, "email"));
  const code = codeSchema.safeParse(field(form, "code"));
  if (!email.success) return { status: "error", message: "Start again with your email address." };
  if (!code.success) {
    return { status: "error", message: code.error.issues[0]?.message ?? "Enter the 6-digit code." };
  }
  if (!(await rateLimit("otp-verify", email.data, 10, 600))) {
    return { status: "error", message: "Too many tries. Ask for a new code in a few minutes." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: "email" });
  if (error) return { status: "error", message: "That code didn't work. Check it, or send a new one." };

  redirect(safeNext(field(form, "next")));
}

async function googleEnabled(): Promise<boolean> {
  const env = publicEnv();
  if (!env) return false;
  try {
    const res = await fetch(`${env.url}/auth/v1/settings`, {
      headers: { apikey: env.publishableKey },
      cache: "no-store",
    });
    const settings = (await res.json()) as { external?: { google?: boolean } };
    return settings.external?.google === true;
  } catch {
    return true; // Unknown: let Supabase report the problem on its own page.
  }
}

export async function signInWithGoogle(form: FormData): Promise<void> {
  const next = safeNext(field(form, "next"));
  if (!(await rateLimit("oauth-ip", await clientIp(), 20, 3600))) redirect("/login?error=busy");
  if (!(await googleEnabled())) redirect(`/login?error=google-off&next=${encodeURIComponent(next)}`);

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect(`/login?error=google&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
