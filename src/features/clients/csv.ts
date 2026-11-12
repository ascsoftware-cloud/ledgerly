import type { ImportField } from "./schema";

/**
 * A small RFC 4180 parser. Detects comma or semicolon (Excel in South Africa often
 * saves with semicolons), strips the byte-order mark, keeps quoted commas and line
 * breaks, and drops fully empty lines.
 */
export function parseCsv(input: string): { headers: string[]; rows: string[][] } {
  const text = input.replace(/^﻿/, "");
  if (!text.trim()) return { headers: [], rows: [] };

  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    records.push(row);
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  const [headers = [], ...rows] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows };
}

const HINTS: Record<ImportField, RegExp> = {
  name: /^(full\s*)?name$|^client|^contact|^naam|^customer/i,
  email: /e-?mail|^epos/i,
  phone: /phone|cell|mobile|tel|selfoon|whatsapp/i,
  company: /company|business|organi[sz]ation|maatskappy|besigheid/i,
  address: /address|adres|street/i,
};

/** Best guess of which column holds each field; null when nothing looks right. */
export function guessMapping(headers: string[]): Record<ImportField, number | null> {
  const used = new Set<number>();
  const pick = (field: ImportField) => {
    const i = headers.findIndex((h, idx) => !used.has(idx) && HINTS[field].test(h.trim()));
    if (i === -1) return null;
    used.add(i);
    return i;
  };
  // Email before name, so "Email name" style headers don't steal the name slot.
  const email = pick("email");
  const phone = pick("phone");
  const company = pick("company");
  const address = pick("address");
  const name = pick("name");
  return { name, email, phone, company, address };
}
