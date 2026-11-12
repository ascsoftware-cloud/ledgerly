"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { sendErrorMessage } from "@/features/sales/status";
import { sageCompanies } from "@/server/integrations/accounting-service";
import { queueShopSync, releaseAtProvider } from "@/server/integrations/connections";
import { DEFAULT_BASE_URL } from "@/server/integrations/courier-guy";
import { testKey } from "@/server/integrations/courier-guy-service";
import {
  courierDefaultsSchema,
  courierGuyConnectSchema,
  lowStockSchema,
  mappingSchema,
  sageConnectSchema,
} from "./schema";

export type FormResult =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string }
  | { status: "choose"; message: string; companies: { value: string; label: string }[] };

async function managers(slug: string) {
  const ctx = await requireWorkspace(slug);
  return ctx.role === "owner" || ctx.role === "admin" ? ctx : null;
}

function first<T>(r: z.ZodSafeParseResult<T>): string {
  return r.success ? "" : (r.error.issues[0]?.message ?? "Check the form.");
}

const page = (slug: string) => `/${slug}/settings/integrations`;

async function currentSettings(
  workspaceId: string,
  connectionId: string,
): Promise<Record<string, unknown> | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("integration_connections")
    .select("settings")
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId)
    .neq("status", "disabled")
    .maybeSingle();
  return data ? ((data.settings as Record<string, unknown> | null) ?? {}) : null;
}

async function saveSettings(
  workspaceId: string,
  connectionId: string,
  patch: Record<string, unknown>,
) {
  const current = await currentSettings(workspaceId, connectionId);
  if (!current) return { error: { code: "no_data_found", message: "That app isn't connected." } };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("update_integration_settings", {
    p_connection: connectionId,
    p_settings: { ...current, ...patch },
  });
  return { error };
}

export async function connectCourierGuy(
  slug: string,
  _prev: FormResult,
  form: FormData,
): Promise<FormResult> {
  const parsed = courierGuyConnectSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { status: "error", message: first(parsed) };
  const ctx = await managers(slug);
  if (!ctx) return { status: "error", message: "Only owners and admins can connect apps." };
  if (!(await rateLimit("app-connect", ctx.workspace.id, 20, 3600)))
    return { status: "error", message: "Too many attempts. Try again later." };
  const check = await testKey(parsed.data.apiKey, DEFAULT_BASE_URL);
  if (!check.ok) return { status: "error", message: check.message };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("connect_integration", {
    p_workspace: ctx.workspace.id,
    p_provider: "courier_guy",
    p_mode: parsed.data.mode,
    p_external_id: null,
    p_external_name: "Courier Guy",
    p_settings: { base_url: DEFAULT_BASE_URL },
    p_secret: parsed.data.apiKey,
    p_refresh: null,
    p_expires_in: null,
  });
  if (error) return { status: "error", message: sendErrorMessage(error) };
  revalidatePath(page(slug));
  return { status: "saved", message: "Courier Guy connected. Add your collection address next." };
}

function pick(form: FormData, prefix: string, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, String(form.get(`${prefix}${k}`) ?? "")]));
}

export async function saveCourierDefaults(
  slug: string,
  connectionId: string,
  _prev: FormResult,
  form: FormData,
): Promise<FormResult> {
  if (!z.uuid().safeParse(connectionId).success)
    return { status: "error", message: "That app isn't connected." };
  const parsed = courierDefaultsSchema.safeParse({
    collection: pick(form, "a_", [
      "type",
      "company",
      "street_address",
      "local_area",
      "city",
      "zone",
      "code",
    ]),
    contact: pick(form, "c_", ["name", "email", "mobile_number"]),
  });
  if (!parsed.success) return { status: "error", message: first(parsed) };
  const ctx = await managers(slug);
  if (!ctx) return { status: "error", message: "Only owners and admins can change app settings." };
  const { error } = await saveSettings(ctx.workspace.id, connectionId, {
    collection: parsed.data.collection,
    collection_contact: parsed.data.contact,
  });
  if (error) return { status: "error", message: sendErrorMessage(error) };
  revalidatePath(page(slug));
  return { status: "saved", message: "Collection address saved." };
}

export async function connectSage(
  slug: string,
  _prev: FormResult,
  form: FormData,
): Promise<FormResult> {
  const parsed = sageConnectSchema.safeParse({
    username: form.get("username"),
    password: form.get("password"),
    companyId: form.get("companyId") || undefined,
  });
  if (!parsed.success) return { status: "error", message: first(parsed) };
  const ctx = await managers(slug);
  if (!ctx) return { status: "error", message: "Only owners and admins can connect apps." };
  // Sage blocks a login for 24 hours after too many requests: be gentle with retries.
  if (!(await rateLimit("app-connect", ctx.workspace.id, 10, 3600)))
    return { status: "error", message: "Too many attempts. Try again later." };
  const found = await sageCompanies(parsed.data.username, parsed.data.password);
  if (!found.ok) return { status: "error", message: found.message };
  const company =
    found.companies.length === 1
      ? found.companies[0]!
      : found.companies.find((c) => c.value === parsed.data.companyId);
  if (!company) {
    return {
      status: "choose",
      message: "Which Sage company should Ledgerly send to?",
      companies: found.companies,
    };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("connect_integration", {
    p_workspace: ctx.workspace.id,
    p_provider: "sage_za",
    p_mode: "live",
    p_external_id: company.value,
    p_external_name: company.label,
    p_settings: { _username: parsed.data.username.toLowerCase() },
    p_secret: parsed.data.password,
    p_refresh: null,
    p_expires_in: null,
  });
  if (error) return { status: "error", message: sendErrorMessage(error) };
  revalidatePath(page(slug));
  return {
    status: "saved",
    message: `Sage connected to ${company.label}. Choose the accounts below.`,
  };
}

export async function saveMapping(
  slug: string,
  connectionId: string,
  _prev: FormResult,
  form: FormData,
): Promise<FormResult> {
  if (!z.uuid().safeParse(connectionId).success)
    return { status: "error", message: "That app isn't connected." };
  const parsed = mappingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { status: "error", message: first(parsed) };
  const ctx = await managers(slug);
  if (!ctx) return { status: "error", message: "Only owners and admins can change app settings." };
  if (!parsed.data.sales_account || !parsed.data.tax_standard) {
    return { status: "error", message: "Choose a sales account and a VAT rate for 15% lines." };
  }
  const { error } = await saveSettings(ctx.workspace.id, connectionId, parsed.data);
  if (error) return { status: "error", message: sendErrorMessage(error) };
  revalidatePath(page(slug));
  return {
    status: "saved",
    message: "Saved. New invoices and payments will be sent with these accounts.",
  };
}

export async function saveLowStock(
  slug: string,
  connectionId: string,
  _prev: FormResult,
  form: FormData,
): Promise<FormResult> {
  if (!z.uuid().safeParse(connectionId).success)
    return { status: "error", message: "That app isn't connected." };
  const parsed = lowStockSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { status: "error", message: first(parsed) };
  const ctx = await managers(slug);
  if (!ctx) return { status: "error", message: "Only owners and admins can change app settings." };
  const { error } = await saveSettings(ctx.workspace.id, connectionId, {
    low_stock: parsed.data.low_stock,
  });
  if (error) return { status: "error", message: sendErrorMessage(error) };
  revalidatePath(page(slug));
  revalidatePath(`/${slug}/shop`);
  return { status: "saved", message: "Low-stock level saved." };
}

export async function disconnectApp(slug: string, connectionId: string): Promise<{ ok: boolean }> {
  if (!z.uuid().safeParse(connectionId).success) return { ok: false };
  const ctx = await managers(slug);
  if (!ctx) return { ok: false };
  await releaseAtProvider(ctx.workspace.id, connectionId);
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("disconnect_integration", { p_connection: connectionId });
  revalidatePath(page(slug));
  return { ok: !error };
}

export async function retryJob(
  slug: string,
  jobId: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!z.uuid().safeParse(jobId).success) return { ok: false };
  const ctx = await managers(slug);
  if (!ctx) return { ok: false };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("retry_integration_job", { p_job: jobId });
  revalidatePath(page(slug));
  return error ? { ok: false, message: sendErrorMessage(error) } : { ok: true };
}

export async function sendToAccounting(
  slug: string,
  documentId: string,
): Promise<{ ok: boolean; message: string }> {
  if (!z.uuid().safeParse(documentId).success)
    return { ok: false, message: "That document doesn't exist." };
  const ctx = await requireWorkspace(slug);
  if (ctx.role === "staff")
    return { ok: false, message: "Your role can't send documents to accounting." };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("queue_accounting_push", { p_document: documentId });
  revalidatePath(`/${slug}/money/${documentId}`);
  return error
    ? { ok: false, message: sendErrorMessage(error) }
    : { ok: true, message: "Queued. It usually arrives within a minute." };
}

export async function refreshShop(slug: string): Promise<{ ok: boolean }> {
  const ctx = await managers(slug);
  if (!ctx) return { ok: false };
  const ok = await queueShopSync(ctx.workspace.id);
  revalidatePath(`/${slug}/shop`);
  return { ok };
}

export async function setNavTab(slug: string, tab: "accounting" | "courier" | "shopify", shown: boolean): Promise<{ ok: boolean }> {
  if (!["accounting", "courier", "shopify"].includes(tab) || typeof shown !== "boolean") return { ok: false };
  const ctx = await managers(slug);
  if (!ctx) return { ok: false };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_nav_tab", { p_workspace: ctx.workspace.id, p_tab: tab, p_shown: shown });
  revalidatePath(`/${slug}`, "layout");
  return { ok: !error };
}
