import { describe, expect, test } from "vitest";
import { processPurge } from "./purge-core";
import { buildExportZip, exportFileName, fileEntryName, tableCsv } from "../../features/privacy/export-zip";
import { unzipSync, strFromU8 } from "fflate";

describe("processPurge", () => {
  function setup(opts: { failFilesFor?: string; failDeleteFor?: string; failUserFor?: string } = {}) {
    const calls: string[] = [];
    const deps = {
      removeFiles: async (ws: string) => {
        calls.push(`files:${ws}`);
        if (ws === opts.failFilesFor) throw new Error("storage down");
      },
      deleteWorkspace: async (ws: string) => {
        calls.push(`ws:${ws}`);
        if (ws === opts.failDeleteFor) throw new Error("fk");
      },
      deleteUser: async (u: string) => {
        calls.push(`user:${u}`);
        if (u === opts.failUserFor) throw new Error("auth");
      },
    };
    return { calls, deps };
  }

  test("a business's files go first, then its rows; accounts last", async () => {
    const { calls, deps } = setup();
    const r = await processPurge({ workspaces: ["w1", "w2"], users: ["u1"] }, deps);
    expect(calls).toEqual(["files:w1", "ws:w1", "files:w2", "ws:w2", "user:u1"]);
    expect(r).toEqual({ workspaces: 2, users: 1, failed: 0 });
  });
  test("if its files cannot be removed the business is kept, so nothing is orphaned, and the rest carry on", async () => {
    const { calls, deps } = setup({ failFilesFor: "w1" });
    const r = await processPurge({ workspaces: ["w1", "w2"], users: [] }, deps);
    expect(calls).toEqual(["files:w1", "files:w2", "ws:w2"]);
    expect(r).toEqual({ workspaces: 1, users: 0, failed: 1 });
  });
  test("a failure deleting one business or one account does not stop the others", async () => {
    const { calls, deps } = setup({ failDeleteFor: "w1", failUserFor: "u1" });
    const r = await processPurge({ workspaces: ["w1", "w2"], users: ["u1", "u2"] }, deps);
    expect(calls).toContain("ws:w2");
    expect(calls).toContain("user:u2");
    expect(r).toEqual({ workspaces: 1, users: 1, failed: 2 });
  });
  test("nothing due does nothing", async () => {
    const { calls, deps } = setup();
    expect(await processPurge({ workspaces: [], users: [] }, deps)).toEqual({ workspaces: 0, users: 0, failed: 0 });
    expect(calls).toEqual([]);
  });
});

describe("the export ZIP", () => {
  const data = { workspaces: [{ id: "w", name: "Acme" }], contacts: [{ id: "c1", name: "Thandi" }], tasks: [] };

  test("has one JSON file per table, a readme and a manifest", () => {
    const zip = buildExportZip({ slug: "acme", exportedAt: new Date("2026-11-13T10:00:00Z"), data, files: [] });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["MANIFEST.json", "README.txt", "data/contacts.csv", "data/contacts.json", "data/tasks.csv", "data/tasks.json", "data/workspaces.csv", "data/workspaces.json"]);
    expect(JSON.parse(strFromU8(files["data/contacts.json"]!))).toEqual([{ id: "c1", name: "Thandi" }]);
    const manifest = JSON.parse(strFromU8(files["MANIFEST.json"]!));
    expect(manifest).toMatchObject({ business: "acme", exportedAt: "2026-11-13T10:00:00.000Z", tables: { contacts: 1, tasks: 0, workspaces: 1 }, files: { included: 0, skipped: 0 } });
    expect(strFromU8(files["README.txt"]!)).toContain("acme");
  });
  test("includes uploaded files under files/, and says which were left out", () => {
    const zip = buildExportZip({
      slug: "acme",
      exportedAt: new Date("2026-11-13T10:00:00Z"),
      data,
      files: [{ name: "documents/abc/lease.pdf", bytes: new Uint8Array([1, 2, 3]) }],
      skipped: ["receipts/big.jpg"],
    });
    const files = unzipSync(zip);
    expect([...files["files/documents/abc/lease.pdf"]!]).toEqual([1, 2, 3]);
    const manifest = JSON.parse(strFromU8(files["MANIFEST.json"]!));
    expect(manifest.files).toEqual({ included: 1, skipped: 1 });
    expect(manifest.skippedFiles).toEqual(["receipts/big.jpg"]);
  });
  test("a table name or file path cannot climb out of the archive", () => {
    const zip = buildExportZip({ slug: "acme", exportedAt: new Date(), data: { "../evil": [] }, files: [{ name: "../../etc/passwd", bytes: new Uint8Array([1]) }] });
    for (const name of Object.keys(unzipSync(zip))) {
      expect(name).not.toContain("..");
      expect(name.startsWith("/")).toBe(false);
    }
  });
  test("the CSV opens cleanly in a spreadsheet", () => {
    const BOM = String.fromCharCode(0xfeff);
    const CRLF = String.fromCharCode(13, 10);
    const csv = tableCsv([
      { id: "1", name: "Thandi, Mokoena", note: "=HYPERLINK(1)", total_cents: 115000, paid: true, tags: ["a"], gone: null },
      { id: "2", name: "Pieter", extra: "only here" },
    ]);
    expect(csv.startsWith(BOM)).toBe(true);
    const lines = csv.slice(1).split(CRLF);
    expect(lines[0]).toBe("id,name,note,total_cents,paid,tags,gone,extra");
    expect(lines[1]).toBe("1," + '"Thandi, Mokoena"' + ",'=HYPERLINK(1)," + '115000,true,"[""a""]",,');
    expect(lines[2]).toBe("2,Pieter,,,,,,only here");
    expect(tableCsv([])).toBe(BOM + CRLF);
  });
  test("file and download names are plain", () => {
    expect(exportFileName("acme", new Date("2026-11-13T10:00:00Z"))).toBe("ledgerly-acme-2026-11-13.zip");
    expect(fileEntryName("receipts/../x y.png")).toBe("files/receipts/x_y.png");
  });
});
