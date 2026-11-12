"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { decodeCsv, parseCsv } from "@/features/clients/csv";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { importStatement } from "../actions";
import { type BankMapping, findTable, toBankLines } from "../parse";

type Table = { fileName: string; rows: string[][]; headers: string[]; firstDataRow: number };

const REASONS = { summary: "balance or summary rows", "no date": "rows without a date", "no amount": "rows without an amount" } as const;

/** Upload a statement CSV, confirm which column is which, see what will be added, import. */
export function BankImport({ slug }: { slug: string }) {
  const router = useRouter();
  const [table, setTable] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<BankMapping | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const result = useMemo(
    () => (table && mapping ? toBankLines(table.rows.slice(table.firstDataRow), mapping, table.firstDataRow) : null),
    [table, mapping],
  );

  async function onFile(file: File | undefined) {
    setError("");
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError("That file is over 5 MB. Export a shorter date range.");
    const { headers, rows } = parseCsv(decodeCsv(new Uint8Array(await file.arrayBuffer())));
    const all = headers.length ? [headers, ...rows] : rows;
    if (!all.length) return setError("That file is empty.");
    const t = findTable(all);
    setTable({ fileName: file.name, rows: all, headers: t.headers, firstDataRow: t.firstDataRow });
    setMapping(t.mapping);
  }

  const col = (key: "date" | "amount" | "debit" | "credit", label: string) => (
    <label className="space-y-1 text-sm font-medium">
      {label}
      <select
        value={mapping?.[key] ?? ""}
        onChange={(e) => mapping && setMapping({ ...mapping, [key]: e.target.value === "" ? null : Number(e.target.value) })}
        className="h-12 w-full rounded-xl border bg-background px-3 text-base"
      >
        <option value="">—</option>
        {table?.headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );

  if (!table || !mapping) {
    return (
      <section aria-label="Import a statement" className="rounded-2xl border border-dashed bg-card p-5">
        <h2 className="font-semibold">Import a bank statement</h2>
        <p className="text-sm text-muted-foreground">
          Download a CSV from your online banking (FNB, Standard Bank, Absa, Nedbank, Capitec and others) and add it here. Lines you have already imported are skipped.
        </p>
        <label className="mt-3 inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
          <Upload className="size-5" aria-hidden /> Choose CSV file
          <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="Bank statement CSV" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
    );
  }

  const lines = result?.lines ?? [];
  const skipped = result?.skipped ?? [];
  const counts = skipped.reduce<Record<string, number>>((a, s) => ({ ...a, [s.reason]: (a[s.reason] ?? 0) + 1 }), {});
  const split = mapping.amount === null;

  return (
    <section aria-label="Check the columns" className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
      <h2 className="font-semibold">Check the columns in {table.fileName}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {col("date", "Date")}
        {split ? (
          <>
            {col("debit", "Money out (debit)")}
            {col("credit", "Money in (credit)")}
          </>
        ) : (
          col("amount", "Amount")
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={split}
          onChange={(e) => setMapping({ ...mapping, amount: e.target.checked ? null : mapping.amount ?? mapping.credit, debit: e.target.checked ? mapping.debit : null, credit: e.target.checked ? mapping.credit : null })}
          className="size-5 accent-primary"
        />
        Money in and money out are in separate columns
      </label>
      <fieldset className="space-y-1 text-sm">
        <legend className="font-medium">Description (tick every column that describes the transaction)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {table.headers.map((h, i) => (
            <label key={i} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={mapping.description.includes(i)}
                onChange={(e) =>
                  setMapping({ ...mapping, description: e.target.checked ? [...mapping.description, i].sort((a, b) => a - b) : mapping.description.filter((x) => x !== i) })
                }
                className="size-5 accent-primary"
              />
              {h || `Column ${i + 1}`}
            </label>
          ))}
        </div>
      </fieldset>

      <div role="status" className="rounded-xl bg-muted p-3 text-sm">
        <p className="font-medium">
          {lines.length} transaction{lines.length === 1 ? "" : "s"} found
          {lines.length > 0 && ` · in ${formatMoney(lines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0))}, out ${formatMoney(-lines.filter((l) => l.amountCents < 0).reduce((s, l) => s + l.amountCents, 0))}`}
        </p>
        {Object.entries(counts).map(([reason, n]) => (
          <p key={reason} className="text-muted-foreground">
            Skipped {n} {REASONS[reason as keyof typeof REASONS]} (rows {skipped.filter((s) => s.reason === reason).slice(0, 5).map((s) => s.row).join(", ")}
            {n > 5 ? ", …" : ""}).
          </p>
        ))}
      </div>
      {lines.length > 0 && (
        <ul className="divide-y rounded-xl border text-sm" aria-label="Preview">
          {lines.slice(0, 5).map((l, i) => (
            <li key={i} className="flex justify-between gap-3 px-3 py-2">
              <span className="truncate">
                {formatDate(l.postedOn)} · {l.description || "—"}
              </span>
              <span className={`tabular-nums ${l.amountCents > 0 ? "text-success" : ""}`}>{formatMoney(l.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          size="touch"
          disabled={pending || lines.length === 0}
          onClick={() =>
            start(async () => {
              const r = await importStatement(slug, { fileName: table.fileName, lines });
              if (!r.ok) return void toast.error(r.message);
              toast.success(`Added ${r.added} line${r.added === 1 ? "" : "s"}${r.duplicates ? `, skipped ${r.duplicates} already imported` : ""}.`);
              setTable(null);
              setMapping(null);
              router.refresh();
            })
          }
        >
          {pending ? "Importing…" : `Import ${lines.length} transaction${lines.length === 1 ? "" : "s"}`}
        </Button>
        <Button type="button" variant="ghost" size="touch" onClick={() => (setTable(null), setMapping(null))}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
