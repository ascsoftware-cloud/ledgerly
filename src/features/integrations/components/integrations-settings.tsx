"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BookOpen, CheckCircle2, RotateCcw, ShoppingBag, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MappingOptions } from "@/server/integrations/accounting-service";
import { PROVINCES } from "@/server/integrations/courier-guy";
import {
  connectCourierGuy,
  connectSage,
  disconnectApp,
  retryJob,
  saveCourierDefaults,
  saveLowStock,
  saveMapping,
  type FormResult,
} from "../actions";
import type { IntegrationConnection, IntegrationJob } from "../queries";

const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";

function Result({ state }: { state: FormResult }) {
  if (state.status === "idle") return null;
  const error = state.status === "error";
  return (
    <p
      role={error ? "alert" : "status"}
      className={error ? "text-sm text-destructive" : "text-sm text-success"}
    >
      {state.message}
    </p>
  );
}

function Card({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: typeof Truck;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
      <header className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Connected({
  slug,
  conn,
  label,
}: {
  slug: string;
  conn: IntegrationConnection;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const reauth = conn.status === "needs_reauth";
  return (
    <div className="space-y-2">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 ${reauth ? "bg-destructive/10" : "bg-success/10"}`}
      >
        <p className="flex items-center gap-2 font-medium">
          {reauth ? (
            <AlertTriangle className="size-5 text-destructive" aria-hidden />
          ) : (
            <CheckCircle2 className="size-5 text-success" aria-hidden />
          )}
          {reauth ? `${label} needs reconnecting` : `${label} connected`}
          {conn.external_name && conn.external_name !== label && (
            <span className="text-sm font-normal text-muted-foreground">
              · {conn.external_name}
            </span>
          )}
          {conn.mode === "test" && (
            <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold">Test</span>
          )}
        </p>
        <Button
          variant="ghost"
          size="touch"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await disconnectApp(slug, conn.id);
              if (r.ok) toast.success(`${label} disconnected. Its credentials were deleted.`);
              else toast.error("Couldn't disconnect. Try again.");
              router.refresh();
            })
          }
        >
          Disconnect
        </Button>
      </div>
      {conn.last_error && <p className="text-sm text-destructive">{conn.last_error}</p>}
    </div>
  );
}

function Unavailable({ what }: { what: string }) {
  return (
    <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
      {what} isn&apos;t switched on for this Ledgerly server yet. ASC adds the app keys once; then
      every business can connect.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Courier Guy
// ---------------------------------------------------------------------------
function CourierGuy({ slug, conn }: { slug: string; conn: IntegrationConnection | undefined }) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    connectCourierGuy.bind(null, slug),
    { status: "idle" },
  );
  const [key, setKey] = useState("");
  const [mode, setMode] = useState<"test" | "live">("live");
  return (
    <Card
      icon={Truck}
      title="Courier Guy"
      body="Get courier quotes and book collections from an invoice. Waybills and tracking show on the invoice."
    >
      {conn ? (
        <>
          <Connected slug={slug} conn={conn} label="Courier Guy" />
          <CourierDefaults slug={slug} conn={conn} />
        </>
      ) : (
        <form action={action} noValidate className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            API key
            <Input
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="h-12 font-mono text-base"
            />
            <span className="block text-xs font-normal text-muted-foreground">
              In your Courier Guy portal: Integrations → API keys. Stored encrypted and never shown
              again.
            </span>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Account
            <select
              name="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as "test" | "live")}
              className={field}
            >
              <option value="live">Live account</option>
              <option value="test">Sandbox account</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" size="touch" disabled={pending || !key}>
              {pending ? "Checking the key…" : "Connect Courier Guy"}
            </Button>
          </div>
          <div className="sm:col-span-2">
            <Result state={state} />
          </div>
        </form>
      )}
    </Card>
  );
}

function CourierDefaults({ slug, conn }: { slug: string; conn: IntegrationConnection }) {
  const c = (conn.settings.collection ?? {}) as Record<string, string>;
  const p = (conn.settings.collection_contact ?? {}) as Record<string, string>;
  const [state, action, pending] = useActionState<FormResult, FormData>(
    saveCourierDefaults.bind(null, slug, conn.id),
    { status: "idle" },
  );
  const [a, setA] = useState({
    type: c.type ?? "business",
    company: c.company ?? "",
    street_address: c.street_address ?? "",
    local_area: c.local_area ?? "",
    city: c.city ?? "",
    zone: c.zone ?? "Gauteng",
    code: c.code ?? "",
  });
  const [who, setWho] = useState({
    name: p.name ?? "",
    email: p.email ?? "",
    mobile_number: p.mobile_number ?? "",
  });
  const text = (k: keyof typeof a, label: string, extra: Record<string, string> = {}) => (
    <label className="space-y-1 text-sm font-medium">
      {label}
      <Input
        name={`a_${k}`}
        value={a[k]}
        onChange={(e) => setA({ ...a, [k]: e.target.value })}
        className="h-12 text-base"
        {...extra}
      />
    </label>
  );
  return (
    <form
      action={action}
      noValidate
      className="grid gap-3 border-t pt-4 sm:grid-cols-2"
      aria-label="Collection address"
    >
      <h3 className="font-medium sm:col-span-2">Collect parcels from</h3>
      {text("company", "Business name")}
      {text("street_address", "Street address")}
      {text("local_area", "Suburb")}
      {text("city", "Town or city")}
      <label className="space-y-1 text-sm font-medium">
        Province
        <select
          name="a_zone"
          value={a.zone}
          onChange={(e) => setA({ ...a, zone: e.target.value })}
          className={field}
        >
          {PROVINCES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      {text("code", "Postal code", { inputMode: "numeric" })}
      <input type="hidden" name="a_type" value={a.type} />
      <label className="space-y-1 text-sm font-medium">
        Contact person
        <Input
          name="c_name"
          value={who.name}
          onChange={(e) => setWho({ ...who, name: e.target.value })}
          className="h-12 text-base"
        />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Mobile number
        <Input
          name="c_mobile_number"
          inputMode="tel"
          value={who.mobile_number}
          onChange={(e) => setWho({ ...who, mobile_number: e.target.value })}
          className="h-12 text-base"
        />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Email
        <Input
          name="c_email"
          type="email"
          value={who.email}
          onChange={(e) => setWho({ ...who, email: e.target.value })}
          className="h-12 text-base"
        />
      </label>
      <div className="flex items-end">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Saving…" : "Save collection address"}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <Result state={state} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Shopify
// ---------------------------------------------------------------------------
function Shopify({
  slug,
  conn,
  available,
}: {
  slug: string;
  conn: IntegrationConnection | undefined;
  available: boolean;
}) {
  const [shop, setShop] = useState("");
  const low =
    typeof conn?.settings.low_stock === "number" ? (conn.settings.low_stock as number) : 5;
  const [lowState, lowAction, lowPending] = useActionState<FormResult, FormData>(
    async (prev: FormResult, form: FormData) =>
      conn ? saveLowStock(slug, conn.id, prev, form) : prev,
    { status: "idle" },
  );
  const [lowValue, setLowValue] = useState(String(low));
  return (
    <Card
      icon={ShoppingBag}
      title="Shopify"
      body="See your store's products, stock and orders in Ledgerly. Read-only: nothing is changed in Shopify."
    >
      {conn ? (
        <>
          <Connected slug={slug} conn={conn} label="Shopify" />
          <div className="flex flex-wrap items-end gap-3">
            <a href={`/${slug}/shop`} className={buttonVariants({ size: "touch" })}>
              Open the Shop dashboard
            </a>
            <form action={lowAction} noValidate className="flex items-end gap-2">
              <label className="space-y-1 text-sm font-medium">
                Low stock at or below
                <Input
                  name="low_stock"
                  inputMode="numeric"
                  value={lowValue}
                  onChange={(e) => setLowValue(e.target.value)}
                  className="h-12 w-28 text-base"
                />
              </label>
              <Button type="submit" variant="outline" size="touch" disabled={lowPending}>
                Save
              </Button>
            </form>
          </div>
          <Result state={lowState} />
          {conn.last_sync_at && (
            <p className="text-sm text-muted-foreground">
              Last full refresh {new Date(conn.last_sync_at).toLocaleString("en-ZA")}.
            </p>
          )}
        </>
      ) : !available ? (
        <Unavailable what="Shopify" />
      ) : (
        // A link, not a form: the CSP's form-action 'self' blocks a form submission that ends
        // in a redirect to Shopify.
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 space-y-1 text-sm font-medium">
            Store address
            <Input
              value={shop}
              onChange={(e) => setShop(e.target.value)}
              placeholder="your-store.myshopify.com"
              className="h-12 text-base"
            />
          </label>
          {shop.trim() ? (
            <a
              href={`/api/oauth/shopify/start?${new URLSearchParams({ ws: slug, shop: shop.trim() })}`}
              className={buttonVariants({ size: "touch" })}
            >
              Connect Shopify
            </a>
          ) : (
            <Button size="touch" disabled>
              Connect Shopify
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Accounting (Xero and Sage)
// ---------------------------------------------------------------------------
function Mapping({
  slug,
  conn,
  options,
  label,
}: {
  slug: string;
  conn: IntegrationConnection;
  options: MappingOptions | null;
  label: string;
}) {
  const s = conn.settings as Record<string, string | undefined>;
  const [state, action, pending] = useActionState<FormResult, FormData>(
    saveMapping.bind(null, slug, conn.id),
    { status: "idle" },
  );
  const [m, setM] = useState({
    sales_account: s.sales_account ?? "",
    bank_account: s.bank_account ?? "",
    tax_standard: s.tax_standard ?? "",
    tax_zero: s.tax_zero ?? "",
  });
  if (!options) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load your {label} accounts right now. Refresh the page to try again.
      </p>
    );
  }
  const select = (
    k: keyof typeof m,
    text: string,
    list: { value: string; label: string }[],
    hint?: string,
  ) => (
    <label className="space-y-1 text-sm font-medium">
      {text}
      <select
        name={k}
        value={m[k]}
        onChange={(e) => setM({ ...m, [k]: e.target.value })}
        className={field}
      >
        <option value="">Choose…</option>
        {list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
  const missing = !s.sales_account || !s.tax_standard;
  return (
    <form
      action={action}
      noValidate
      className="grid gap-3 border-t pt-4 sm:grid-cols-2"
      aria-label={`${label} accounts`}
    >
      <h3 className="font-medium sm:col-span-2">Where things go in {label}</h3>
      {missing && (
        <p className="text-sm text-destructive sm:col-span-2">
          Nothing is sent to {label} until a sales account and a 15% VAT rate are chosen.
        </p>
      )}
      {select("sales_account", "Sales account", options.sales)}
      {select(
        "bank_account",
        "Bank account for payments",
        options.banks,
        "Payments recorded in Ledgerly are entered here.",
      )}
      {select("tax_standard", "VAT on 15% lines", options.taxes)}
      {select(
        "tax_zero",
        "VAT on 0% lines",
        options.taxes,
        "Zero-rated or exempt, as your accountant prefers.",
      )}
      <div className="sm:col-span-2 space-y-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

function Xero({
  slug,
  conn,
  options,
  available,
}: {
  slug: string;
  conn: IntegrationConnection | undefined;
  options: MappingOptions | null;
  available: boolean;
}) {
  return (
    <Card
      icon={BookOpen}
      title="Xero"
      body="Sends each invoice, credit note and payment to Xero as you send or record it. Ledgerly stays in charge; Xero gets a copy."
    >
      {conn ? (
        <>
          <Connected slug={slug} conn={conn} label="Xero" />
          {conn.status === "needs_reauth" && (
            <a
              href={`/api/oauth/xero/start?ws=${slug}`}
              className={buttonVariants({ size: "touch" })}
            >
              Reconnect Xero
            </a>
          )}
          {conn.status === "active" && (
            <Mapping slug={slug} conn={conn} options={options} label="Xero" />
          )}
        </>
      ) : !available ? (
        <Unavailable what="Xero" />
      ) : (
        <div className="space-y-2">
          <a
            href={`/api/oauth/xero/start?ws=${slug}`}
            className={buttonVariants({ size: "touch" })}
          >
            Connect Xero
          </a>
          <p className="text-xs text-muted-foreground">
            You&apos;ll sign in to Xero and choose one organisation. Only invoices sent from now on
            are copied.
          </p>
        </div>
      )}
    </Card>
  );
}

function Sage({
  slug,
  conn,
  options,
  available,
}: {
  slug: string;
  conn: IntegrationConnection | undefined;
  options: MappingOptions | null;
  available: boolean;
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    connectSage.bind(null, slug),
    { status: "idle" },
  );
  const [f, setF] = useState({ username: "", password: "", companyId: "" });
  return (
    <Card
      icon={BookOpen}
      title="Sage Accounting"
      body="For Sage Business Cloud Accounting (South Africa). Sends invoices, credit notes and receipts as they happen."
    >
      {conn ? (
        <>
          <Connected slug={slug} conn={conn} label="Sage" />
          {conn.status === "active" && (
            <Mapping slug={slug} conn={conn} options={options} label="Sage" />
          )}
          <p className="text-xs text-muted-foreground">
            Sage&apos;s API can&apos;t void documents or allocate receipts: do those in Sage.
            Ledgerly lists anything that needs you below.
          </p>
        </>
      ) : !available ? (
        <Unavailable what="Sage" />
      ) : (
        <form action={action} noValidate className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            Sage email
            <Input
              name="username"
              type="email"
              autoComplete="off"
              value={f.username}
              onChange={(e) => setF({ ...f, username: e.target.value })}
              className="h-12 text-base"
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Sage password
            <Input
              name="password"
              type="password"
              autoComplete="off"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              className="h-12 text-base"
            />
          </label>
          {state.status === "choose" && (
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Company
              <select
                name="companyId"
                value={f.companyId}
                onChange={(e) => setF({ ...f, companyId: e.target.value })}
                className={field}
              >
                <option value="">Choose…</option>
                {state.companies.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Sage&apos;s South African API signs in with your Sage login, so Ledgerly stores it
            encrypted. Consider a separate Sage user for Ledgerly with only the access it needs. Too
            many failed attempts make Sage block the login for 24 hours.
          </p>
          <div className="sm:col-span-2 space-y-2">
            <Button
              type="submit"
              size="touch"
              disabled={
                pending || !f.username || !f.password || (state.status === "choose" && !f.companyId)
              }
            >
              {pending ? "Checking with Sage…" : "Connect Sage"}
            </Button>
            <Result state={state} />
          </div>
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Things that need a person
// ---------------------------------------------------------------------------
const KIND = {
  push_document: "Send document",
  void_document: "Void document",
  push_payment: "Send payment",
  shopify_sync: "Shopify refresh",
  shopify_refresh: "Shopify update",
  track_shipment: "Parcel tracking",
} as Record<string, string>;

export function FailedJobs({
  slug,
  jobs,
  names,
  canRetry = true,
}: {
  slug: string;
  jobs: IntegrationJob[];
  names: Record<string, string>;
  canRetry?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!jobs.length) return null;
  return (
    <section
      aria-labelledby="failed-heading"
      className="space-y-3 rounded-2xl border border-destructive/40 bg-card p-5 shadow-card"
    >
      <h2 id="failed-heading" className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-5 text-destructive" aria-hidden /> Needs your attention
      </h2>
      <ul className="divide-y text-sm">
        {jobs.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {KIND[j.kind] ?? j.kind} · {names[j.connection_id] ?? "App"}
                {j.entity_id && (j.kind === "push_document" || j.kind === "void_document") && (
                  <a
                    href={`/${slug}/money/${j.entity_id}`}
                    className="ml-2 text-primary hover:underline"
                  >
                    Open
                  </a>
                )}
              </p>
              <p className="break-words text-muted-foreground">{j.last_error ?? "Failed"}</p>
            </div>
            {canRetry && (
              <Button
                variant="outline"
                size="touch"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await retryJob(slug, j.id);
                    if (r.ok) toast.success("Trying again.");
                    else toast.error(r.message ?? "Couldn't retry.");
                    router.refresh();
                  })
                }
              >
                <RotateCcw className="size-4" aria-hidden /> Try again
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function IntegrationsSettings({
  slug,
  connections,
  failed,
  options,
  available,
}: {
  slug: string;
  connections: Partial<
    Record<"courier_guy" | "shopify" | "xero" | "sage_za", IntegrationConnection>
  >;
  failed: IntegrationJob[];
  options: { xero: MappingOptions | null; sage_za: MappingOptions | null };
  available: { xero: boolean; shopify: boolean; sage_za: boolean };
}) {
  const names = Object.fromEntries(
    Object.values(connections).map((c) => [
      c!.id,
      { courier_guy: "Courier Guy", shopify: "Shopify", xero: "Xero", sage_za: "Sage" }[
        c!.provider
      ],
    ]),
  );
  return (
    <div className="space-y-6">
      <FailedJobs slug={slug} jobs={failed} names={names} />
      <Xero slug={slug} conn={connections.xero} options={options.xero} available={available.xero} />
      <Sage
        slug={slug}
        conn={connections.sage_za}
        options={options.sage_za}
        available={available.sage_za}
      />
      <CourierGuy slug={slug} conn={connections.courier_guy} />
      <Shopify slug={slug} conn={connections.shopify} available={available.shopify} />
      <p className="text-sm text-muted-foreground">
        App credentials are stored encrypted and are deleted when you disconnect. Stitch (pay by
        bank) is under Getting paid.
      </p>
    </div>
  );
}
