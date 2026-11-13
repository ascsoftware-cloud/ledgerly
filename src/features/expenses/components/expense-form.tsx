"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { scanReceipt } from "@/features/assistant/actions";
import { Input } from "@/components/ui/input";
import { saveExpense, type ExpenseFormResult } from "../actions";
import { CADENCES, EXPENSE_METHODS } from "../schema";

export type ExpenseInitial = {
  amount: string;
  spentOn: string;
  supplier: string;
  categoryId: string;
  includesVat: boolean;
  method: string;
  description: string;
  hasReceipt: boolean;
};

const EMPTY: ExpenseInitial = {
  amount: "",
  spentOn: "",
  supplier: "",
  categoryId: "",
  includesVat: false,
  method: "card",
  description: "",
  hasReceipt: false,
};

/** Log or edit an expense. Amount and category are all that is needed; the rest is optional. */
export function ExpenseForm({
  slug,
  expenseId = null,
  categories,
  initial,
  canRepeat = false,
  vatRegistered = false,
  aiScan = false,
}: {
  slug: string;
  expenseId?: string | null;
  categories: { id: string; name: string }[];
  initial?: ExpenseInitial;
  /** Owners and admins can make a new expense repeat. */
  canRepeat?: boolean;
  /** Only VAT-registered businesses can claim input VAT, so only they see the VAT toggle. */
  vatRegistered?: boolean;
  /** The AI helper is on: offer to read a receipt photo into the fields. */
  aiScan?: boolean;
}) {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const [v, setV] = useState<ExpenseInitial>(initial ?? { ...EMPTY, includesVat: vatRegistered });
  const showVat = vatRegistered || v.includesVat;
  const [repeat, setRepeat] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, startScan] = useTransition();
  const [scanNote, setScanNote] = useState<{ ok: boolean; text: string } | null>(null);

  function scan() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setScanNote({ ok: false, text: "Choose a photo of the receipt first." });
    setScanNote(null);
    const form = new FormData();
    form.set("receipt", file);
    startScan(async () => {
      const r = await scanReceipt(slug, form);
      if (r.status === "error") return setScanNote({ ok: false, text: r.message });
      setV((cur) => ({ ...cur, amount: r.amount, supplier: r.supplier || cur.supplier, spentOn: r.spentOn || cur.spentOn, includesVat: vatRegistered && r.includesVat }));
      setScanNote({ ok: true, text: "Filled in from the photo. Please check the amount, supplier and date before you save." });
    });
  }
  const set = (k: keyof ExpenseInitial) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV({ ...v, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  const [state, action, pending] = useActionState<ExpenseFormResult, FormData>(async (prev, form) => {
    const r = await saveExpense(slug, expenseId, prev, form);
    if (r.status === "saved") {
      toast.success(r.message);
      router.push(`/${slug}/money/expenses`);
    }
    return r;
  }, { status: "idle" });

  const field = "h-12 w-full rounded-xl border bg-background px-3 text-base";
  return (
    <form action={action} noValidate aria-label={expenseId ? "Edit expense" : "Log an expense"} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-card sm:grid-cols-2">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="space-y-1 text-sm font-medium">
        Amount (R)
        <Input name="amount" inputMode="decimal" value={v.amount} onChange={set("amount")} placeholder="1 150,00" className="h-12 text-base" autoFocus={!expenseId} />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Category
        <select name="categoryId" value={v.categoryId} onChange={set("categoryId")} className={field}>
          <option value="">Choose…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {showVat && (
        <label className="flex items-center gap-3 text-sm font-medium sm:col-span-2">
          <input type="checkbox" name="includesVat" checked={v.includesVat} onChange={set("includesVat")} className="size-5 accent-primary" />
          The amount includes 15% VAT I can claim back
        </label>
      )}
      <label className="space-y-1 text-sm font-medium">
        Supplier <span className="font-normal text-muted-foreground">(optional)</span>
        <Input name="supplier" value={v.supplier} onChange={set("supplier")} placeholder="Engen, Makro, landlord…" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Date <span className="font-normal text-muted-foreground">(blank = today)</span>
        <Input name="spentOn" value={v.spentOn} onChange={set("spentOn")} placeholder="31/01/2027" inputMode="numeric" className="h-12 text-base" />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Paid by
        <select name="method" value={v.method} onChange={set("method")} className={field}>
          {Object.entries(EXPENSE_METHODS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium">
        Receipt <span className="font-normal text-muted-foreground">({v.hasReceipt ? "replace — " : ""}photo or PDF, up to 5 MB)</span>
        <input ref={fileRef} name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="block w-full py-3 text-sm" />
      </label>
      {aiScan && !expenseId && (
        <div className="space-y-1 sm:col-span-2">
          <Button type="button" variant="outline" size="touch" onClick={scan} disabled={scanning}>
            {scanning ? "Reading…" : "Fill in from the photo (AI)"}
          </Button>
          {scanNote && (
            <p role={scanNote.ok ? "status" : "alert"} className={scanNote.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
              {scanNote.text}
            </p>
          )}
        </div>
      )}
      {canRepeat && !expenseId && (
        <label className="space-y-1 text-sm font-medium">
          This repeats <span className="font-normal text-muted-foreground">(rent, subscriptions)</span>
          <select name="repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={field}>
            <option value="">Just this once</option>
            {Object.entries(CADENCES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Note <span className="font-normal text-muted-foreground">(optional)</span>
        <textarea name="description" value={v.description} onChange={set("description")} rows={2} maxLength={300} className="w-full rounded-xl border bg-background p-3 text-base" />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="touch" disabled={pending}>
          {pending ? "Saving…" : expenseId ? "Save changes" : "Log expense"}
        </Button>
        <Button type="button" variant="ghost" size="touch" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
