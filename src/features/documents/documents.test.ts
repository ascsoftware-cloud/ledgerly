import { describe, expect, test } from "vitest";
import { buildPortalEmail } from "@/server/jobs/email-template";
import { builtinData, contractSchema, customFields, extractFields, fileSchema, folderSchema, isAllowedFile, renderTemplate, signSchema, templateSchema } from "./schema";

describe("extractFields", () => {
  test("lists each merge field once, in order of first use", () => {
    expect(extractFields("Hi {{client_name}}, pay {{ amount }} to {{business_name}}. Bye {{client_name}}.")).toEqual(["client_name", "amount", "business_name"]);
  });
  test("ignores things that are not field names", () => {
    expect(extractFields("{{Bad Name}} {{ }} {{1abc}} {{a-b}} { {x} } {{x")).toEqual([]);
  });
});

describe("customFields", () => {
  test("are the fields the person must fill in (everything except the built-ins)", () => {
    expect(customFields("{{client_name}} owes {{amount}} by {{due_date}} to {{business_name}} on {{today}}")).toEqual(["amount", "due_date"]);
  });
});

describe("renderTemplate", () => {
  const data = { client_name: "Thandi", business_name: "Olga Plumbing" };

  test("fills the fields", () => {
    expect(renderTemplate("Between {{business_name}} and {{ client_name }}.", data)).toBe("Between Olga Plumbing and Thandi.");
  });

  test("html mode (the default) escapes what was typed into a field", () => {
    const out = renderTemplate("Dear {{client_name}}", { client_name: `<script>alert("x")</script> & 'co'` });
    expect(out).toBe("Dear &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;co&#39;");
    expect(out).not.toContain("<script>");
  });

  test("text mode keeps the value exactly, for storing and showing as text", () => {
    expect(renderTemplate("Dear {{client_name}}", { client_name: `<b>O'Neil</b> & Sons` }, "text")).toBe("Dear <b>O'Neil</b> & Sons");
  });

  test("a field with no value stays visible so it is not missed", () => {
    expect(renderTemplate("Pay {{amount}} to {{business_name}}", data)).toBe("Pay {{amount}} to Olga Plumbing");
  });

  test("values are not expanded a second time", () => {
    expect(renderTemplate("{{client_name}} / {{business_name}}", { client_name: "{{business_name}}", business_name: "Olga" })).toBe("{{business_name}} / Olga");
  });

  test("replacement patterns inside a value are plain text", () => {
    expect(renderTemplate("A {{client_name}} B", { client_name: "$& $1 $$ $`" }, "text")).toBe("A $& $1 $$ $` B");
  });

  test("the template's own text is never escaped or changed", () => {
    expect(renderTemplate("Terms & <conditions> apply to {{client_name}}", data, "html")).toBe("Terms & <conditions> apply to Thandi");
  });
});

describe("builtinData", () => {
  test("fills the client and business fields, and today in South African format", () => {
    expect(builtinData({ client: { name: "Thandi Mokoena", email: "t@c.test", phone: "+27821234567", company: "Mokoena Tiling" }, businessName: "Olga Plumbing", today: "2026-11-13" })).toEqual({
      client_name: "Thandi Mokoena",
      client_email: "t@c.test",
      client_phone: "+27821234567",
      client_company: "Mokoena Tiling",
      business_name: "Olga Plumbing",
      today: "13 Nov 2026",
    });
  });
  test("missing client details become empty, not 'null'", () => {
    const d = builtinData({ client: { name: "Thandi", email: null, phone: null, company: null }, businessName: "B", today: "2026-01-02" });
    expect(d.client_email).toBe("");
    expect(d.client_company).toBe("");
  });
});

describe("schemas", () => {
  test("a template needs a name and a body", () => {
    expect(templateSchema.safeParse({ name: "Agreement", body: "Hello {{client_name}}" }).success).toBe(true);
    expect(templateSchema.safeParse({ name: "", body: "x" }).success).toBe(false);
    expect(templateSchema.safeParse({ name: "A", body: "   " }).success).toBe(false);
    expect(templateSchema.safeParse({ name: "A", body: "x".repeat(20001) }).success).toBe(false);
  });

  test("a contract needs a client, a title and text", () => {
    const ok = { contactId: "6c0b5c7e-3a1d-4b8a-9c3e-2f1a0b9c8d7e", title: "Service agreement", body: "Text" };
    expect(contractSchema.safeParse(ok).success).toBe(true);
    expect(contractSchema.safeParse({ ...ok, contactId: "nope" }).success).toBe(false);
    expect(contractSchema.safeParse({ ...ok, title: " " }).success).toBe(false);
  });

  test("a folder name is short and not blank", () => {
    expect(folderSchema.parse({ name: " Leases " })).toEqual({ name: "Leases" });
    expect(folderSchema.safeParse({ name: " " }).success).toBe(false);
    expect(folderSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });

  test("signing needs a typed name; a drawn mark must be a small PNG", () => {
    expect(signSchema.parse({ name: " Thandi Mokoena " })).toEqual({ name: "Thandi Mokoena", image: null });
    expect(signSchema.safeParse({ name: "T" }).success).toBe(false);
    expect(signSchema.safeParse({ name: "Thandi", image: "data:image/jpeg;base64,AAAA" }).success).toBe(false);
    expect(signSchema.safeParse({ name: "Thandi", image: `data:image/png;base64,${"A".repeat(150000)}` }).success).toBe(false);
    expect(signSchema.parse({ name: "Thandi", image: "data:image/png;base64,iVBORw0KGgo=" }).image).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(signSchema.parse({ name: "Thandi", image: "" }).image).toBeNull();
  });
});

describe("files", () => {
  test.each([
    ["Lease.pdf", "application/pdf", 1000, true],
    ["photo.JPG", "image/jpeg", 5_000_000, true],
    ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1000, true],
    ["notes.txt", "text/plain", 10, true],
    ["run.exe", "application/x-msdownload", 1000, false],
    ["page.html", "text/html", 1000, false],
    ["image.svg", "image/svg+xml", 1000, false],
    ["big.pdf", "application/pdf", 10_485_761, false],
    ["empty.pdf", "application/pdf", 0, false],
  ])("%s (%s, %i bytes) allowed: %s", (name, type, size, ok) => {
    expect(isAllowedFile({ name, type, size })).toBe(ok);
  });

  test("a stored file name is trimmed and kept short; its path never comes from the user's name", () => {
    expect(fileSchema.parse({ name: "  ../../etc/passwd.pdf " }).name).toBe("passwd.pdf");
    expect(fileSchema.parse({ name: "a".repeat(300) + ".pdf" }).name.length).toBeLessThanOrEqual(200);
  });
});

describe("buildPortalEmail", () => {
  const input = { businessName: "Olga Plumbing", clientName: "Thandi Mokoena", link: "https://business.ascsoftware.co.za/portal/abc_DEF-123", message: "Here are your <documents>" };
  test("greets by first name, links to the portal, and keeps the message", () => {
    const m = buildPortalEmail(input);
    expect(m.subject).toBe("Your documents from Olga Plumbing");
    expect(m.text).toContain("Hi Thandi,");
    expect(m.text).toContain(input.link);
    expect(m.text).toContain("Here are your <documents>");
  });
  test("escapes the message and names in the HTML", () => {
    const m = buildPortalEmail({ ...input, businessName: "<i>Bad</i>" });
    expect(m.html).toContain("Here are your &lt;documents&gt;");
    expect(m.html).not.toContain("<i>Bad</i>");
  });
});
