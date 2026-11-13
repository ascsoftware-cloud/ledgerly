"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { signSchema } from "@/features/documents/schema";
import { requestIp } from "@/features/sales/public-data";
import { rateLimit } from "@/lib/rate-limit";
import { signContract } from "@/server/portal/sign";

export type SignState = { status: "idle" } | { status: "signed" } | { status: "error"; message: string };

/** A client signs their own contract from the portal. Rate-limited per visitor; the database checks it is theirs. */
export async function signFromPortal(token: string, contractId: string, _prev: SignState, form: FormData): Promise<SignState> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token) || !z.uuid().safeParse(contractId).success) return { status: "error", message: "This link isn't valid." };
  if (form.get("agree") !== "on") return { status: "error", message: "Tick the box to confirm you agree to sign." };
  const parsed = signSchema.safeParse({ name: form.get("name") ?? "", image: form.get("image") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  const ip = await requestIp();
  if (!(await rateLimit("accept-ip", ip, 10, 3600))) return { status: "error", message: "Too many attempts from your connection. Try again later." };
  const ua = (await headers()).get("user-agent") ?? "";
  const r = await signContract({ token, contractId, name: parsed.data.name, image: parsed.data.image, ip, userAgent: ua });
  if (!r.ok) return { status: "error", message: r.message };
  revalidatePath(`/portal/${token}`);
  return { status: "signed" };
}
