"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { deleteImport, ignoreLine, lineToExpense, matchLine, resetLine } from "../actions";

type Line = {
  id: string;
  posted_on: string;
  amount_cents: number;
  description: string;
  status: "new" | "matched" | "expense" | "ignored";
  number: string | null;
};
type Invoice = { id: string; number: string; owedCents: number; client: string };

/** One statement line and the one decision it needs: which invoice it paid, or what it was spent on. */
export function BankLineItem({
  slug,
  line,
  canWrite,
  invoices,
  suggested,
  categories,
}: {
  slug: string;
  line: Line;
  canWrite: boolean;
  invoices: Invoice[];
  suggested: string | null;
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const moneyIn = line.amount_cents > 0;
  const [doc, setDoc] = useState(suggested ?? "");
  const [cat, setCat] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        router.refresh();
      } else toast.error(r.message ?? "Couldn't do that. Try again.");
    });
  const label = `${formatDate(line.posted_on)} ${line.description}`;

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3" aria-label={label}>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{line.description || "—"}</span>
        <span className="block text-sm text-muted-foreground">{formatDate(line.posted_on)}</span>
      </span>
      <span className={`font-medium tabular-nums ${moneyIn ? "text-success" : ""}`}>{formatMoney(line.amount_cents)}</span>
      {line.status !== "new" ? (
        <span className="flex basis-full items-center justify-end gap-2 text-sm text-muted-foreground sm:basis-auto">
          {line.status === "matched" && `Paid ${line.number ?? "an invoice"}`}
          {line.status === "expense" && "Logged as an expense"}
          {line.status === "ignored" && "Ignored"}
          {(line.status === "matched" || line.status === "expense") && canWrite && (
            <Button type="button" variant="ghost" size="touch" disabled={pending} onClick={() => run(() => resetLine(slug, line.id), "Back on the to-do list")}>
              Undo
            </Button>
          )}
          {line.status === "ignored" && canWrite && (
            <Button type="button" variant="ghost" size="touch" disabled={pending} onClick={() => run(() => ignoreLine(slug, line.id, false), "Back on the to-do list")}>
              Undo
            </Button>
          )}
        </span>
      ) : canWrite ? (
        <span className="flex basis-full flex-wrap items-center justify-end gap-2">
          {moneyIn ? (
            <>
              <select
                aria-label={`Invoice paid by ${label}`}
                value={doc}
                onChange={(e) => setDoc(e.target.value)}
                className="h-11 max-w-64 rounded-xl border bg-background px-3 text-sm"
              >
                <option value="">Which invoice?</option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} · {i.client} · {formatMoney(i.owedCents)} owed
                  </option>
                ))}
              </select>
              <Button type="button" size="touch" disabled={pending || !doc} onClick={() => run(() => matchLine(slug, line.id, doc), "Payment recorded")}>
                {suggested && doc === suggested ? "Confirm match" : "Match"}
              </Button>
            </>
          ) : (
            <>
              <select aria-label={`Category for ${label}`} value={cat} onChange={(e) => setCat(e.target.value)} className="h-11 max-w-56 rounded-xl border bg-background px-3 text-sm">
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button type="button" size="touch" disabled={pending} onClick={() => run(() => lineToExpense(slug, line.id, cat || null), "Expense logged")}>
                Make expense
              </Button>
            </>
          )}
          <Button type="button" variant="ghost" size="touch" disabled={pending} onClick={() => run(() => ignoreLine(slug, line.id, true), "Ignored")}>
            Ignore
          </Button>
        </span>
      ) : null}
    </li>
  );
}

/** Deletes a statement import that nothing has been matched or logged from yet. */
export function DeleteImport({ slug, id, name }: { slug: string; id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  if (!confirming)
    return (
      <Button type="button" variant="ghost" size="touch" aria-label={`Delete ${name}`} onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  return (
    <span className="flex gap-1">
      <Button
        type="button"
        variant="destructive"
        size="touch"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await deleteImport(slug, id);
            setConfirming(false);
            if (!r.ok) return void toast.error(r.message ?? "Couldn't delete that import.");
            toast.success("Import deleted");
            router.refresh();
          })
        }
      >
        Yes, delete it
      </Button>
      <Button type="button" variant="ghost" size="touch" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}
