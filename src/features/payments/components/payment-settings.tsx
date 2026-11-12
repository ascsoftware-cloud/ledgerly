"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, CreditCard, Landmark, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectPayfast, connectStitch, connectYoco, disconnectProvider, saveBankDetails, type FormResult } from "../actions";
import { SA_BANKS, type BankDetails } from "../schema";

type Connection = { id: string; mode: "test" | "live"; merchant_id: string | null } | null;

function Result({ state }: { state: FormResult }) {
  if (state.status === "idle") return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
      {state.message}
    </p>
  );
}

function Card({ icon: Icon, title, body, children }: { icon: typeof Landmark; title: string; body: string; children: React.ReactNode }) {
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

const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";

function Connected({ slug, conn, label }: { slug: string; conn: NonNullable<Connection>; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-success/10 px-4 py-3">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="size-5 text-success" aria-hidden /> {label} connected
        <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold">{conn.mode === "live" ? "Live" : "Test mode"}</span>
      </p>
      <Button
        variant="ghost"
        size="touch"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await disconnectProvider(slug, conn.id);
            if (r.ok) toast.success(`${label} disconnected. Its keys were deleted.`);
            else toast.error("Couldn't disconnect. Try again.");
            router.refresh();
          })
        }
      >
        Disconnect
      </Button>
    </div>
  );
}

export function PaymentSettings({
  slug,
  yoco,
  payfast,
  stitch,
  bank,
  siteUrl,
}: {
  slug: string;
  yoco: Connection;
  payfast: Connection;
  stitch: (NonNullable<Connection> & { client_id?: string | null }) | null;
  bank: Partial<BankDetails> | null;
  siteUrl: string;
}) {
  const [bankState, bankAction, bankPending] = useActionState<FormResult, FormData>(saveBankDetails.bind(null, slug), { status: "idle" });
  const [yocoState, yocoAction, yocoPending] = useActionState<FormResult, FormData>(connectYoco.bind(null, slug), { status: "idle" });
  const [pfState, pfAction, pfPending] = useActionState<FormResult, FormData>(connectPayfast.bind(null, slug), { status: "idle" });

  // Controlled, because React clears a form's fields after each submit, errors included.
  const [b, setB] = useState<BankDetails>({
    bank: (bank?.bank as BankDetails["bank"]) ?? "FNB",
    account_holder: bank?.account_holder ?? "",
    account_number: bank?.account_number ?? "",
    branch_code: bank?.branch_code ?? "",
    account_type: (bank?.account_type as BankDetails["account_type"]) ?? "Cheque",
  });
  const [yocoKey, setYocoKey] = useState("");
  const [pf, setPf] = useState({ merchantId: "", merchantKey: "", passphrase: "", mode: "test" as "test" | "live" });
  const [stState, stAction, stPending] = useActionState<FormResult, FormData>(connectStitch.bind(null, slug), { status: "idle" });
  const [st, setSt] = useState({ clientId: "", clientSecret: "", webhookSecret: "", mode: "test" as "test" | "live" });

  return (
    <div className="space-y-6">
      <Card icon={Landmark} title="EFT (bank transfer)" body="Shown on every invoice, with the invoice number as the reference. Free for you and your clients.">
        <form action={bankAction} noValidate className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            Bank
            <select name="bank" value={b.bank} onChange={(e) => setB({ ...b, bank: e.target.value as BankDetails["bank"] })} className={field}>
              {SA_BANKS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Account holder
            <Input name="account_holder" value={b.account_holder} onChange={(e) => setB({ ...b, account_holder: e.target.value })} className="h-12 text-base" />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Account number
            <Input name="account_number" inputMode="numeric" value={b.account_number} onChange={(e) => setB({ ...b, account_number: e.target.value })} className="h-12 text-base" />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Branch code
            <Input name="branch_code" inputMode="numeric" value={b.branch_code} onChange={(e) => setB({ ...b, branch_code: e.target.value })} className="h-12 text-base" />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Account type
            <select name="account_type" value={b.account_type} onChange={(e) => setB({ ...b, account_type: e.target.value as BankDetails["account_type"] })} className={field}>
              {["Cheque", "Savings", "Business", "Transmission"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" size="touch" disabled={bankPending}>
              {bankPending ? "Saving…" : "Save bank details"}
            </Button>
          </div>
          <div className="sm:col-span-2">
            <Result state={bankState} />
          </div>
        </form>
      </Card>

      <Card icon={CreditCard} title="Yoco" body="Card payments into your own Yoco account. Your clients tap Pay by card on the invoice.">
        {yoco ? (
          <Connected slug={slug} conn={yoco} label="Yoco" />
        ) : (
          <form action={yocoAction} noValidate className="space-y-3">
            <label className="block space-y-1 text-sm font-medium">
              Secret key
              <Input
                name="secretKey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={yocoKey}
                onChange={(e) => setYocoKey(e.target.value)}
                placeholder="sk_test_… or sk_live_…"
                className="h-12 font-mono text-base"
              />
              <span className="block text-xs font-normal text-muted-foreground">
                In the Yoco portal: Sales → Payment gateway → API keys. It is stored encrypted and never shown again.
              </span>
            </label>
            <Button type="submit" size="touch" disabled={yocoPending || !yocoKey}>
              {yocoPending ? "Connecting…" : "Connect Yoco"}
            </Button>
            <Result state={yocoState} />
          </form>
        )}
      </Card>

      <Card icon={Zap} title="PayFast" body="Card, Instant EFT, SnapScan and more, into your own PayFast account.">
        {payfast ? (
          <Connected slug={slug} conn={payfast} label="PayFast" />
        ) : (
          <form action={pfAction} noValidate className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Merchant ID
              <Input name="merchantId" inputMode="numeric" value={pf.merchantId} onChange={(e) => setPf({ ...pf, merchantId: e.target.value })} className="h-12 text-base" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Merchant key
              <Input name="merchantKey" autoComplete="off" spellCheck={false} value={pf.merchantKey} onChange={(e) => setPf({ ...pf, merchantKey: e.target.value })} className="h-12 font-mono text-base" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Passphrase <span className="font-normal text-muted-foreground">(if set in PayFast)</span>
              <Input name="passphrase" type="password" autoComplete="off" value={pf.passphrase} onChange={(e) => setPf({ ...pf, passphrase: e.target.value })} className="h-12 text-base" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Mode
              <select name="mode" value={pf.mode} onChange={(e) => setPf({ ...pf, mode: e.target.value as "test" | "live" })} className={field}>
                <option value="test">Sandbox (testing)</option>
                <option value="live">Live</option>
              </select>
            </label>
            <div className="sm:col-span-2 space-y-2">
              <Button type="submit" size="touch" disabled={pfPending || !pf.merchantId || !pf.merchantKey}>
                {pfPending ? "Connecting…" : "Connect PayFast"}
              </Button>
              <Result state={pfState} />
            </div>
          </form>
        )}
      </Card>
      <Card icon={Building2} title="Stitch" body="Pay by bank (instant EFT) into your own account, through your own Stitch client.">
        {stitch ? (
          <div className="space-y-3">
            <Connected slug={slug} conn={stitch} label="Stitch" />
            <p className="text-sm text-muted-foreground">
              Webhook address for Stitch (event type <code>payment</code>):{" "}
              <code className="break-all">{`${siteUrl}/api/webhooks/stitch/${stitch.id}`}</code>. Without it, payments are still
              confirmed when your client comes back from their bank.
            </p>
          </div>
        ) : (
          <form action={stAction} noValidate className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Client ID
              <Input name="clientId" autoComplete="off" spellCheck={false} value={st.clientId} onChange={(e) => setSt({ ...st, clientId: e.target.value })} className="h-12 font-mono text-base" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Client secret
              <Input name="clientSecret" type="password" autoComplete="off" value={st.clientSecret} onChange={(e) => setSt({ ...st, clientSecret: e.target.value })} className="h-12 text-base" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Webhook signing secret <span className="font-normal text-muted-foreground">(optional, whsec_…)</span>
              <Input name="webhookSecret" type="password" autoComplete="off" value={st.webhookSecret} onChange={(e) => setSt({ ...st, webhookSecret: e.target.value })} className="h-12 font-mono text-base" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Mode
              <select name="mode" value={st.mode} onChange={(e) => setSt({ ...st, mode: e.target.value as "test" | "live" })} className={field}>
                <option value="test">Test client</option>
                <option value="live">Live client</option>
              </select>
            </label>
            <div className="sm:col-span-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                Stitch issues the client ID and secret once your business is approved. Ask Stitch to allow redirects to {siteUrl}.
              </p>
              <Button type="submit" size="touch" disabled={stPending || !st.clientId || !st.clientSecret}>
                {stPending ? "Checking with Stitch…" : "Connect Stitch"}
              </Button>
              <Result state={stState} />
            </div>
          </form>
        )}
      </Card>
      <p className="text-sm text-muted-foreground">
        Money goes straight to your own account. Ledgerly never holds your funds and never sees card details.
      </p>
    </div>
  );
}
