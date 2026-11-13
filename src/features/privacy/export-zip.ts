import { strToU8, zipSync, type Zippable } from "fflate";
import { toCsv } from "@/features/reports/schema";

const clean = (s: string) =>
  s
    .split("/")
    .filter((p) => p !== "" && p !== "." && p !== "..")
    .join("/")
    .replace(/[^A-Za-z0-9._/-]+/g, "_");

export function exportFileName(slug: string, at: Date): string {
  return `ledgerly-${clean(slug)}-${at.toISOString().slice(0, 10)}.zip`;
}

/** Where an uploaded file sits inside the archive: always under files/, never above it. */
export function fileEntryName(path: string): string {
  return `files/${clean(path)}`;
}

// The byte-order mark makes Excel read the file as UTF-8 (names with accents).
const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);

/** A table as CSV for spreadsheets: a header row of every column that appears, nested values as JSON, formulas defused. */
export function tableCsv(rows: unknown[]): string {
  const records = rows.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && !Array.isArray(r));
  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string | number => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  };
  return BOM + toCsv([headers, ...records.map((r) => headers.map((h) => cell(r[h])))]) + CRLF;
}

export type ExportFile = { name: string; bytes: Uint8Array };

/**
 * Two files per table (CSV for spreadsheets, JSON with every detail), the uploaded files, a manifest saying what is
 * inside and what was left out, and a plain-words readme. Entry names are sanitised so nothing can be written outside
 * the archive when it is unzipped.
 */
export function buildExportZip(i: {
  slug: string;
  exportedAt: Date;
  data: Record<string, unknown[]>;
  files: ExportFile[];
  skipped?: string[];
}): Uint8Array {
  const entries: Zippable = {};
  const tables: Record<string, number> = {};
  for (const [name, rows] of Object.entries(i.data)) {
    const safe = clean(name).replace(/\//g, "_") || "table";
    entries[`data/${safe}.json`] = strToU8(JSON.stringify(rows, null, 2));
    entries[`data/${safe}.csv`] = strToU8(tableCsv(rows));
    tables[safe] = rows.length;
  }
  for (const f of i.files) entries[fileEntryName(f.name)] = f.bytes;
  const skipped = i.skipped ?? [];
  entries["MANIFEST.json"] = strToU8(
    JSON.stringify(
      {
        business: i.slug,
        exportedAt: i.exportedAt.toISOString(),
        tables,
        files: { included: i.files.length, skipped: skipped.length },
        ...(skipped.length ? { skippedFiles: skipped } : {}),
      },
      null,
      2,
    ),
  );
  entries["README.txt"] = strToU8(
    [
      `Ledgerly export of "${i.slug}", made ${i.exportedAt.toISOString()}.`,
      "",
      "data/   One pair of files per kind of record (clients, invoices, expenses and so on): .csv opens in Excel or Google Sheets, .json keeps every detail.",
      "files/  The files you uploaded (receipts, proofs of payment, documents).",
      "MANIFEST.json  How many records and files are inside, and any files that were too large to include.",
      "",
      "Amounts are in cents (R100,00 is 10000). Dates are in the form 2026-11-13.",
    ].join("\n"),
  );
  return zipSync(entries, { level: 6 });
}
