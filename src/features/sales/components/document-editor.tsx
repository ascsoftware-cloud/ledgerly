"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { calcTotals, formatMoney, parseAmount, type LineInput } from "@/lib/money";
import { saveDraft, type EditorState } from "../actions";
import { parseQuantity, type Kind } from "../schema";

export type EditorLine = { key: string; description: string; quantity: string; unitPrice: string; discount: string; vat: "0" | "15"; productId?: string };

/** What the picker needs of a product (the stock feature owns the full type). */
export type EditorProduct = { id: string; name: string; sku: string | null; priceCents: number; vatRate: 0 | 15; trackStock: boolean; stockQty: number };

let nextKey = 0;
const newLine = (vat: "0" | "15"): EditorLine => ({
  key: `n${nextKey++}`,
  description: "",
  quantity: "1",
  unitPrice: "",
  discount: "",
  vat,
});

/** Lines that are complete enough to price, for the running total. */
function priced(lines: EditorLine[]): LineInput[] {
  return lines.flatMap((l) => {
    const quantity = parseQuantity(l.quantity || "1");
    const unitCents = parseAmount(l.unitPrice);
    const discountPct = l.discount.trim() ? Number(l.discount.replace(",", ".")) : 0;
    if (quantity === null || unitCents === null || !(discountPct >= 0 && discountPct <= 100)) return [];
    return [{ quantity, unitCents, discountPct, vatRate: l.vat === "15" ? 15 : 0 }];
  });
}

const KIND_WORD: Record<Kind, string> = { invoice: "invoice", quote: "quote", credit_note: "credit note" };

export function DocumentEditor({
  slug,
  docId,
  kind,
  contacts,
  vatRegistered,
  products = [],
  initial,
}: {
  slug: string;
  docId: string | null;
  kind: Kind;
  contacts: { id: string; name: string }[];
  vatRegistered: boolean;
  /** Products from the stock list; picking one fills the line and lets invoices take stock off. */
  products?: EditorProduct[];
  initial?: {
    contactId: string;
    dueDate: string;
    notes: string;
    depositType: "none" | "pct" | "amount";
    depositValue: string;
    lines: EditorLine[];
  };
}) {
  const defaultVat = vatRegistered ? "15" : "0";
  const [contactId, setContactId] = useState(initial?.contactId ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [depositType, setDepositType] = useState(initial?.depositType ?? "none");
  const [depositValue, setDepositValue] = useState(initial?.depositValue ?? "");
  const [lines, setLines] = useState<EditorLine[]>(initial?.lines.length ? initial.lines : [newLine(defaultVat)]);
  const [state, action, pending] = useActionState<EditorState, FormData>(saveDraft.bind(null, slug, docId), { status: "idle" });

  const totals = useMemo(() => {
    const dep =
      depositType === "pct"
        ? { type: "pct" as const, value: Number(depositValue.replace(",", ".")) || 0 }
        : depositType === "amount"
          ? { type: "amount" as const, value: parseAmount(depositValue) ?? 0 }
          : undefined;
    return calcTotals(priced(lines), dep);
  }, [lines, depositType, depositValue]);

  const payload = JSON.stringify({
    kind,
    contactId,
    dueDate,
    notes,
    depositType: kind === "credit_note" ? "none" : depositType,
    depositValue,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, vat: l.vat, productId: l.productId ?? "" })),
  });

  const set = (key: string, patch: Partial<EditorLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";

  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="payload" value={payload} />

      {state.status === "error" && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          {state.message}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="contact" className="text-sm font-medium">
            Client
          </label>
          {contacts.length ? (
            <select
              id="contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className={field}
              aria-invalid={state.status === "error" && state.field === "contactId"}
              disabled={kind === "credit_note"}
            >
              <option value="">Choose a client</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Link href={`/${slug}/clients/new`} className="text-primary underline underline-offset-4">
                Add a client
              </Link>{" "}
              first.
            </p>
          )}
        </div>
        {kind !== "credit_note" && (
          <div className="space-y-1.5">
            <label htmlFor="due" className="flex items-baseline justify-between text-sm font-medium">
              {kind === "quote" ? "Valid until" : "Due date"}
              <span className="text-xs font-normal text-muted-foreground">
                Optional. Default {kind === "quote" ? "30" : "14"} days.
              </span>
            </label>
            <Input
              id="due"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              placeholder="31/01/2027"
              inputMode="numeric"
              className="h-12 text-base"
            />
          </div>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Items</legend>
        <ol className="space-y-3">
          {lines.map((l, i) => (
            <li key={l.key} className="grid grid-cols-6 gap-2 rounded-2xl border bg-card p-3 sm:grid-cols-[3fr_1fr_1.4fr_1fr_auto_auto] sm:items-end">
              {products.length > 0 && kind !== "credit_note" && (
                <label className="col-span-6 space-y-1 text-xs font-medium text-muted-foreground sm:col-span-full">
                  Product <span className="font-normal">(optional)</span>
                  <select
                    value={l.productId ?? ""}
                    onChange={(e) => {
                      const p = products.find((x) => x.id === e.target.value);
                      if (!p) return set(l.key, { productId: "" });
                      set(l.key, {
                        productId: p.id,
                        description: p.name,
                        unitPrice: (p.priceCents / 100).toFixed(2).replace(".", ","),
                        vat: vatRegistered ? String(p.vatRate) as "0" | "15" : "0",
                      });
                    }}
                    aria-label={`Line ${i + 1} product`}
                    className="h-11 w-full rounded-lg border bg-background px-2 text-base text-foreground"
                  >
                    <option value="">Not from my stock list</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.trackStock ? ` (${p.stockQty} in stock)` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="col-span-6 space-y-1 text-xs font-medium text-muted-foreground sm:col-span-1">
                Description
                <Input
                  value={l.description}
                  onChange={(e) => set(l.key, { description: e.target.value })}
                  placeholder="What you did or sold"
                  aria-label={`Line ${i + 1} description`}
                  className="h-11 text-base text-foreground"
                />
              </label>
              <label className="col-span-2 space-y-1 text-xs font-medium text-muted-foreground sm:col-span-1">
                Qty
                <Input
                  value={l.quantity}
                  onChange={(e) => set(l.key, { quantity: e.target.value })}
                  inputMode="decimal"
                  aria-label={`Line ${i + 1} quantity`}
                  className="h-11 text-base text-foreground"
                />
              </label>
              <label className="col-span-2 space-y-1 text-xs font-medium text-muted-foreground sm:col-span-1">
                Price (R)
                <Input
                  value={l.unitPrice}
                  onChange={(e) => set(l.key, { unitPrice: e.target.value })}
                  inputMode="decimal"
                  placeholder="0,00"
                  aria-label={`Line ${i + 1} price`}
                  className="h-11 text-base text-foreground"
                />
              </label>
              <label className="col-span-2 space-y-1 text-xs font-medium text-muted-foreground sm:col-span-1">
                Discount %
                <Input
                  value={l.discount}
                  onChange={(e) => set(l.key, { discount: e.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={`Line ${i + 1} discount`}
                  className="h-11 text-base text-foreground"
                />
              </label>
              {vatRegistered ? (
                <label className="col-span-3 space-y-1 text-xs font-medium text-muted-foreground sm:col-span-1">
                  VAT
                  <select
                    value={l.vat}
                    onChange={(e) => set(l.key, { vat: e.target.value as "0" | "15" })}
                    aria-label={`Line ${i + 1} VAT`}
                    className="h-11 w-full rounded-lg border bg-background px-2 text-base text-foreground"
                  >
                    <option value="15">15%</option>
                    <option value="0">0%</option>
                  </select>
                </label>
              ) : (
                <span className="hidden sm:block" />
              )}
              <button
                type="button"
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine(defaultVat)]))}
                aria-label={`Remove line ${i + 1}`}
                className="col-span-3 flex h-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive sm:col-span-1 sm:w-11"
              >
                <Trash2 className="size-5" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
        <Button type="button" variant="outline" size="touch" onClick={() => setLines((ls) => [...ls, newLine(defaultVat)])}>
          <Plus className="size-5" aria-hidden /> Add a line
        </Button>
        {!vatRegistered && (
          <p className="text-xs text-muted-foreground">Not registered for VAT, so no VAT is added.</p>
        )}
      </fieldset>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-4">
          {kind !== "credit_note" && (
            <div className="space-y-1.5">
              <label htmlFor="deposit" className="text-sm font-medium">
                Deposit
              </label>
              <div className="flex gap-2">
                <select
                  id="deposit"
                  value={depositType}
                  onChange={(e) => setDepositType(e.target.value as "none" | "pct" | "amount")}
                  className="h-12 rounded-xl border bg-background px-3 text-base"
                >
                  <option value="none">No deposit</option>
                  <option value="pct">Percentage</option>
                  <option value="amount">Fixed amount</option>
                </select>
                {depositType !== "none" && (
                  <Input
                    value={depositValue}
                    onChange={(e) => setDepositValue(e.target.value)}
                    inputMode="decimal"
                    placeholder={depositType === "pct" ? "50" : "1 000"}
                    aria-label={depositType === "pct" ? "Deposit percentage" : "Deposit amount in rand"}
                    className="h-12 text-base"
                  />
                )}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="notes" className="text-sm font-medium">
              Notes for the client
            </label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Thanks for your business!"
              className="text-base"
            />
          </div>
        </div>

        <dl aria-label="Totals" className="self-start rounded-2xl bg-muted p-5 tabular-nums">
          {vatRegistered && (
            <>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{formatMoney(totals.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">VAT</dt>
                <dd>{formatMoney(totals.vatCents)}</dd>
              </div>
            </>
          )}
          <div className="mt-1 flex justify-between text-lg font-semibold">
            <dt>Total</dt>
            <dd>{formatMoney(totals.totalCents)}</dd>
          </div>
          {totals.depositCents > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Deposit due</dt>
              <dd>{formatMoney(totals.depositCents)}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" name="intent" value="send" size="touch" disabled={pending || !contactId}>
          {pending ? "Working…" : `Save and send ${KIND_WORD[kind]}`}
        </Button>
        <Button type="submit" name="intent" value="save" variant="outline" size="touch" disabled={pending || !contactId}>
          Save draft
        </Button>
      </div>
    </form>
  );
}
