"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { startCheckout, type CheckoutStart } from "@/server/payments/checkout";
import { isToken } from "./public";
import { requestIp } from "./public-data";

export type AcceptState = { status: "idle" } | { status: "error"; message: string } | { status: "accepted"; name: string };

const input = z.object({
  name: z.string().trim().min(2, "Type your full name.").max(120),
  agree: z.literal("on", { message: "Tick the box to confirm you accept." }),
});

export async function acceptQuote(token: string, _prev: AcceptState, form: FormData): Promise<AcceptState> {
  if (!isToken(token)) return { status: "error", message: "This link isn't valid." };
  const parsed = input.safeParse({ name: form.get("name"), agree: form.get("agree") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  const ip = await requestIp();
  if (!(await rateLimit("accept-ip", ip, 10, 3600))) {
    return { status: "error", message: "Too many attempts. Try again later." };
  }
  const ua = (await headers()).get("user-agent")?.slice(0, 400) ?? "";
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("accept_quote", {
    p_token: token,
    p_name: parsed.data.name,
    p_ip: ip,
    p_user_agent: ua,
  });
  if (error) {
    return {
      status: "error",
      message: error.code === "LDG03" ? error.message : "Couldn't record your acceptance. Try again.",
    };
  }
  return { status: "accepted", name: (data as { signer_name?: string } | null)?.signer_name ?? parsed.data.name };
}

/** The payer taps Pay: create a checkout for the balance and send them to the provider. */
export async function payOnline(token: string, provider: "yoco" | "payfast"): Promise<CheckoutStart> {
  if (!isToken(token) || (provider !== "yoco" && provider !== "payfast")) {
    return { ok: false, message: "This link isn't valid." };
  }
  if (!(await rateLimit("pay-ip", await requestIp(), 20, 3600))) {
    return { ok: false, message: "Too many attempts. Try again later." };
  }
  return startCheckout(token, provider);
}
