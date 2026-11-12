"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { importContacts, type ImportResult } from "../actions";
import { decodeCsv, guessMapping, parseCsv } from "../csv";
import { IMPORT_FIELDS, MAX_IMPORT_ROWS, importRowSchema, type ImportField } from "../schema";

const LABELS: Record<ImportField, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  address: "Address",
};

type Mapping = Record<ImportField, number | null>;

function toRecord(row: string[], mapping: Mapping): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of IMPORT_FIELDS) {
    const i = mapping[f];
    out[f] = i === null ? null : (row[i] ?? null);
  }
  return out;
}

export function ImportWizard({ slug }: { slug: string }) {
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Check every row in the browser first, with the same rules the server uses.
  const checked = useMemo(() => {
    if (!file || !mapping) return [];
    return file.rows.map((row, i) => {
      const record = toRecord(row, mapping);
      const r = importRowSchema.safeParse(record);
      return { line: i + 2, record, error: r.success ? null : (r.error.issues[0]?.message ?? "Not valid") };
    });
  }, [file, mapping]);
  const bad = checked.filter((c) => c.error);

  async function onFile(f: File | undefined) {
    setResult(null);
    setReadError(null);
    if (!f) return;
    if (f.size > 2_000_000) {
      setReadError("That file is over 2 MB. Split it into smaller files.");
      return;
    }
    const parsed = parseCsv(decodeCsv(new Uint8Array(await f.arrayBuffer())));
    if (!parsed.headers.length || !parsed.rows.length) {
      setReadError("We couldn't find any rows. The first line should be the column names.");
      return;
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      setReadError(`That file has ${parsed.rows.length} rows. Import up to ${MAX_IMPORT_ROWS} at a time.`);
      return;
    }
    setFile({ name: f.name, ...parsed });
    setMapping(guessMapping(parsed.headers));
  }

  if (result?.ok) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-12 text-center">
        <CheckCircle2 className="size-10 text-success" aria-hidden />
        <h2 className="text-lg font-semibold">
          {result.added} {result.added === 1 ? "client" : "clients"} added
        </h2>
        <Link href={`/${slug}/clients`} className={buttonVariants({ size: "touch" })}>
          See your clients
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed bg-card px-6 py-10 text-center hover:border-primary">
        <FileUp className="size-8 text-primary" aria-hidden />
        <span className="font-semibold">{file ? file.name : "Choose a CSV file"}</span>
        <span className="text-sm text-muted-foreground">
          Export from Excel, Google Sheets or your old system. Up to {MAX_IMPORT_ROWS} rows.
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="CSV file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>
      {readError && (
        <p role="alert" className="text-sm text-destructive">
          {readError}
        </p>
      )}

      {file && mapping && (
        <>
          <fieldset className="space-y-3">
            <legend className="font-semibold">Match your columns</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {IMPORT_FIELDS.map((f) => (
                <label key={f} className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2">
                  <span className="text-sm font-medium">{LABELS[f]}</span>
                  <select
                    aria-label={`Column for ${LABELS[f]}`}
                    value={mapping[f] ?? ""}
                    onChange={(e) =>
                      setMapping({ ...mapping, [f]: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="h-11 min-w-0 max-w-[60%] rounded-lg border bg-background px-2 text-sm"
                  >
                    <option value="">Don&apos;t import</option>
                    {file.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>

          <section aria-labelledby="preview-heading" className="space-y-2">
            <h2 id="preview-heading" className="font-semibold">
              Preview: {file.rows.length} rows{bad.length ? `, ${bad.length} need fixing` : ", all good"}
            </h2>
            <div className="overflow-x-auto rounded-2xl border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Line</th>
                    {IMPORT_FIELDS.map((f) => (
                      <th key={f} className="px-3 py-2 font-medium">
                        {LABELS[f]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(bad.length ? bad : checked).slice(0, 8).map((c) => (
                    <tr key={c.line} className={c.error ? "bg-destructive/5" : ""}>
                      <td className="px-3 py-2 tabular-nums">{c.line}</td>
                      {IMPORT_FIELDS.map((f) => (
                        <td key={f} className="max-w-48 truncate px-3 py-2">
                          {c.record[f]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bad.length > 0 && (
              <ul className="space-y-1 text-sm text-destructive" aria-label="Rows to fix">
                {bad.slice(0, 8).map((c) => (
                  <li key={c.line}>
                    Line {c.line}: {c.error}
                  </li>
                ))}
                {bad.length > 8 && <li>…and {bad.length - 8} more</li>}
              </ul>
            )}
          </section>

          {result && !result.ok && (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
              {result.message}
            </p>
          )}

          <Button
            size="touch"
            disabled={pending || bad.length > 0 || mapping.name === null}
            onClick={() =>
              start(async () => setResult(await importContacts(slug, checked.map((c) => c.record))))
            }
          >
            {pending
              ? "Importing…"
              : mapping.name === null
                ? "Choose the Name column"
                : bad.length
                  ? "Fix the rows above first"
                  : `Import ${file.rows.length} ${file.rows.length === 1 ? "client" : "clients"}`}
          </Button>
        </>
      )}
    </div>
  );
}
