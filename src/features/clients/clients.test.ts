import { describe, expect, test } from "vitest";
import { normalisePhone, whatsappNumber } from "@/lib/phone";
import { decodeCsv, guessMapping, parseCsv } from "./csv";
import { contactInputSchema, importRowSchema } from "./schema";

describe("normalisePhone (South African numbers by default)", () => {
  test.each([
    ["082 123 4567", "+27821234567"],
    ["0821234567", "+27821234567"],
    ["+27 82 123 4567", "+27821234567"],
    ["27821234567", "+27821234567"],
    ["(021) 555-1234", "+27215551234"],
    ["0027 82 123 4567", "+27821234567"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s → %s", (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  test.each(["", "123", "082 123", "not a number", "+27 82 123 4567 999 999"])("%j is rejected", (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  test("a number Excel stripped the leading 0 from is still South African", () => {
    expect(normalisePhone("821234567")).toBe("+27821234567");
    expect(normalisePhone("215551234")).toBe("+27215551234");
  });

  test.each(["442079460958", "12345678", "9821234567"])("bare %s with no country code or 0 is rejected, not guessed", (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  test("WhatsApp wants the number without the plus", () => {
    expect(whatsappNumber("+27821234567")).toBe("27821234567");
  });
});

describe("contactInputSchema", () => {
  test("cleans up what people type", () => {
    expect(
      contactInputSchema.parse({ name: "  Thandi  ", email: " Thandi@Acme.CO.ZA ", phone: "082 123 4567", company: " Acme " }),
    ).toEqual({ name: "Thandi", email: "thandi@acme.co.za", phone: "+27821234567", company: "Acme", address: null });
  });

  test("email, phone, company and address are optional", () => {
    expect(contactInputSchema.parse({ name: "Sipho", email: "", phone: "", company: "", address: "" })).toEqual({
      name: "Sipho",
      email: null,
      phone: null,
      company: null,
      address: null,
    });
  });

  test.each([
    [{ name: "" }, "name"],
    [{ name: "A".repeat(121) }, "name"],
    [{ name: "Ok", email: "nope" }, "email"],
    [{ name: "Ok", phone: "12" }, "phone"],
  ])("rejects %j with an error on %s", (input, field) => {
    const r = contactInputSchema.safeParse(input);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path[0]).toBe(field);
  });
});

describe("parseCsv", () => {
  test("handles commas, quotes, blank lines and Windows line endings", () => {
    const text = 'Name,Email\r\n"Mokoena, Thandi",thandi@acme.test\r\n\r\n"Say ""hi""",x@y.test\r\n';
    expect(parseCsv(text)).toEqual({
      headers: ["Name", "Email"],
      rows: [
        ["Mokoena, Thandi", "thandi@acme.test"],
        ['Say "hi"', "x@y.test"],
      ],
    });
  });

  test("detects semicolons, which Excel uses in South Africa", () => {
    expect(parseCsv("Naam;Selfoon\nSipho;082 123 4567\n")).toEqual({
      headers: ["Naam", "Selfoon"],
      rows: [["Sipho", "082 123 4567"]],
    });
  });

  test("strips the byte-order mark Excel adds", () => {
    expect(parseCsv("﻿Name\nA\n").headers).toEqual(["Name"]);
  });

  test("keeps line breaks inside quoted cells", () => {
    expect(parseCsv('Name,Address\nA,"1 Main Rd\nCape Town"\n').rows).toEqual([["A", "1 Main Rd\nCape Town"]]);
  });

  test("empty input gives no headers and no rows", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("guessMapping", () => {
  test("matches common header names, in English and Afrikaans", () => {
    expect(guessMapping(["Full Name", "E-mail Address", "Cell", "Company", "Notes"])).toEqual({
      name: 0,
      email: 1,
      phone: 2,
      company: 3,
      address: null,
    });
    expect(guessMapping(["Naam", "Epos", "Selfoon", "Maatskappy", "Adres"])).toEqual({
      name: 0,
      email: 1,
      phone: 2,
      company: 3,
      address: 4,
    });
  });

  test("unknown headers map to nothing", () => {
    expect(guessMapping(["a", "b"])).toEqual({ name: null, email: null, phone: null, company: null, address: null });
  });
});

describe("importRowSchema", () => {
  test("a row with a bad email reports which field is wrong", () => {
    const r = importRowSchema.safeParse({ name: "Bad", email: "not-an-email" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path[0]).toBe("email");
  });
});

describe("decodeCsv", () => {
  test("reads UTF-8 and drops the byte-order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Name\nRenée")]);
    expect(decodeCsv(bytes)).toBe("Name\nRenée");
  });

  test("reads Excel's Windows-1252 CSV without mangling accents", () => {
    const bytes = new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x52, 0x65, 0x6e, 0xe9, 0x65, 0x2c, 0x5a, 0x6f, 0xeb]);
    expect(decodeCsv(bytes)).toBe("Name\nRenée,Zoë");
  });
});
