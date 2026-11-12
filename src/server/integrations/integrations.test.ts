import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { mappingGaps, readMapping, type AccountingDocument } from "./accounting";
import * as cg from "./courier-guy";
import {
  centsToRands,
  describeFailure,
  isTransient,
  parseRetryAfter,
  randsToCents,
  requestJson,
} from "./http";
import { finishArgs } from "./job-types";
import { decodePending, encodePending, newState, sameState } from "./oauth-state";
import * as sage from "./sage-za";
import * as sh from "./shopify";
import * as xero from "./xero";

describe("money conversion", () => {
  test.each([
    ["123.45", 12345],
    ["123.4", 12340],
    ["0.005", 1],
    ["0.0049", 0],
    ["1000", 100000],
    [705.56, 70556],
    ["-12.5", -1250],
  ])("randsToCents(%j) = %i", (input, cents) => expect(randsToCents(input)).toBe(cents));
  test.each(["", "abc", "1,5", "1.23456", null, undefined])("randsToCents(%j) is null", (input) =>
    expect(randsToCents(input)).toBeNull(),
  );
  test("centsToRands", () => expect(centsToRands(12345)).toBe(123.45));
});

describe("http helpers", () => {
  test("Retry-After in seconds and as a date", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT", new Date("2026-10-21T07:27:00Z"))).toBe(
      60,
    );
    expect(parseRetryAfter("soon")).toBeNull();
  });
  test("transient means retry later", () => {
    expect(isTransient({ status: 0, networkError: true })).toBe(true);
    expect(isTransient({ status: 429, networkError: false })).toBe(true);
    expect(isTransient({ status: 503, networkError: false })).toBe(true);
    expect(isTransient({ status: 400, networkError: false })).toBe(false);
  });
  test("failure text includes Xero validation messages, never more than 300 characters of detail", () => {
    const msg = describeFailure("Xero", {
      ok: false,
      status: 400,
      body: {
        Elements: [{ ValidationErrors: [{ Message: "Account code '999' is not a valid code" }] }],
      },
      retryAfter: null,
      networkError: false,
    });
    expect(msg).toBe("Xero returned 400: Account code '999' is not a valid code");
    expect(
      describeFailure("X", {
        ok: false,
        status: 500,
        body: "y".repeat(1000),
        retryAfter: null,
        networkError: false,
      }).length,
    ).toBeLessThan(330);
  });
  test("requestJson reports network failures instead of throwing", async () => {
    const r = await requestJson("https://example.invalid", {
      fetcher: (async () => {
        throw new Error("down");
      }) as typeof fetch,
    });
    expect(r).toMatchObject({ ok: false, status: 0, networkError: true });
  });
  test("requestJson parses JSON and reads Retry-After on 429", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ a: 1 }), {
        status: 429,
        headers: { "retry-after": "12" },
      })) as typeof fetch;
    const r = await requestJson("https://x.test", { fetcher });
    expect(r).toMatchObject({ ok: false, status: 429, body: { a: 1 }, retryAfter: 12 });
  });
});

describe("job outcomes", () => {
  test("map to finish_integration_job arguments", () => {
    expect(finishArgs({ ok: true })).toEqual({ ok: true, error: null, retryIn: null });
    expect(finishArgs({ ok: true, continueIn: 2 })).toEqual({ ok: true, error: null, retryIn: 2 });
    expect(finishArgs({ ok: false, error: "fix it", stop: true })).toEqual({
      ok: false,
      error: "fix it",
      retryIn: 0,
    });
    expect(finishArgs({ ok: false, error: "slow", retryIn: 99999 })).toEqual({
      ok: false,
      error: "slow",
      retryIn: 3600,
    });
    expect(finishArgs({ ok: false, error: "x" })).toEqual({ ok: false, error: "x", retryIn: null });
  });
});

describe("OAuth state", () => {
  test("round-trips and rejects tampering", () => {
    const state = newState();
    const raw = encodePending({ state, ws: "acme-tiling", provider: "xero" });
    expect(decodePending(raw)).toEqual({ state, ws: "acme-tiling", provider: "xero" });
    expect(decodePending("not-base64-json")).toBeNull();
    expect(decodePending(encodePending({ state: "short", ws: "x", provider: "xero" }))).toBeNull();
    expect(sameState(state, state)).toBe(true);
    expect(sameState(`${state}x`, state)).toBe(false);
    expect(sameState(null, state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Courier Guy", () => {
  const addr: cg.ShipAddress = {
    type: "business",
    company: "",
    street_address: "1 Church St",
    local_area: "",
    city: "Pretoria",
    zone: "Gauteng",
    code: "0002",
    country: "ZA",
  };
  test("rate requests drop empty optional fields", () => {
    const body = cg.rateRequest({
      collection: addr,
      delivery: { ...addr, code: "8001" },
      parcels: [
        {
          submitted_length_cm: 1,
          submitted_width_cm: 2,
          submitted_height_cm: 3,
          submitted_weight_kg: 4,
          parcel_description: "",
        },
      ],
    });
    expect(body.collection_address).not.toHaveProperty("company");
    expect(body.collection_address).not.toHaveProperty("local_area");
    expect(body.parcels[0]).toEqual({
      submitted_length_cm: 1,
      submitted_width_cm: 2,
      submitted_height_cm: 3,
      submitted_weight_kg: 4,
    });
  });
  test("parses rates at the top level or under result, cheapest first, skipping junk", () => {
    const rates = [
      { rate: "705.56", service_level: { code: "OVN", name: "Overnight" } },
      {
        rate: 120,
        service_level: { code: "ECO", name: "Economy", delivery_date_to: "2027-01-08" },
      },
      { rate: "n/a", service_level: { code: "BAD" } },
    ];
    expect(cg.parseRates({ rates }).map((r) => [r.code, r.cents])).toEqual([
      ["ECO", 12000],
      ["OVN", 70556],
    ]);
    expect(cg.parseRates({ result: { rates } })).toHaveLength(2);
    expect(cg.parseRates(null)).toEqual([]);
  });
  test("parses a booked shipment", () => {
    expect(
      cg.parseShipment({
        id: 123,
        short_tracking_reference: "ABC123",
        status: "submitted",
        rate: "99.90",
      }),
    ).toEqual({
      id: "123",
      trackingRef: "ABC123",
      status: "submitted",
      chargedCents: 9990,
    });
    expect(cg.parseShipment({ status: "submitted" })).toBeNull();
  });
  test.each([
    ["submitted", "booked"],
    ["collection-assigned", "booked"],
    ["collected", "in_transit"],
    ["in-transit", "in_transit"],
    ["out-for-delivery", "in_transit"],
    ["delivered", "delivered"],
    ["cancelled", "cancelled"],
    [null, "booked"],
  ])("status %j → %s", (input, out) => expect(cg.mapStatus(input)).toBe(out));
  test("tracking: shipment at top level or in a list; bad events skipped", () => {
    const t = cg.parseTracking({
      shipments: [
        {
          status: "in-transit",
          tracking_events: [
            { date: "2027-01-05T08:00:00Z", status: "collected", message: "Collected" },
            { date: "nope", status: "x" },
          ],
        },
      ],
    });
    expect(t).toEqual({
      status: "in_transit",
      providerStatus: "in-transit",
      events: [
        {
          at: "2027-01-05T08:00:00.000Z",
          status: "collected",
          message: "Collected",
          location: null,
        },
      ],
    });
  });
  test("waybill link must be https", () => {
    expect(cg.parseLabelUrl('"https://s3.amazonaws.com/x.pdf"')).toBe(
      "https://s3.amazonaws.com/x.pdf",
    );
    expect(cg.parseLabelUrl({ url: "https://x/y.pdf" })).toBe("https://x/y.pdf");
    expect(cg.parseLabelUrl({ url: "javascript:alert(1)" })).toBeNull();
  });
  test("the API key is only ever sent to Courier Guy or Ship Logic over https", () => {
    expect(cg.safeBaseUrl("https://api.shiplogic.com/v2")).toBe("https://api.shiplogic.com");
    expect(cg.safeBaseUrl("https://api.portal.thecourierguy.co.za")).toBe(
      "https://api.portal.thecourierguy.co.za",
    );
    expect(cg.safeBaseUrl("https://evil.example.com")).toBe(cg.DEFAULT_BASE_URL);
    expect(cg.safeBaseUrl("http://api.shiplogic.com")).toBe(cg.DEFAULT_BASE_URL);
    expect(cg.safeBaseUrl("https://shiplogic.com.evil.io")).toBe(cg.DEFAULT_BASE_URL);
  });
  test("a recipient needs an email or a mobile number", () => {
    expect(cg.contactSchema.safeParse({ name: "Thandi" }).success).toBe(false);
    expect(
      cg.contactSchema.safeParse({ name: "Thandi", mobile_number: "082 123 4567" }).data
        ?.mobile_number,
    ).toBe("0821234567");
    expect(cg.addressSchema.safeParse({ ...addr, code: "123" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Shopify", () => {
  test.each([
    ["my-store", "my-store.myshopify.com"],
    ["My-Store.myshopify.com", "my-store.myshopify.com"],
    ["https://my-store.myshopify.com/admin/products", "my-store.myshopify.com"],
    ["https://admin.shopify.com/store/my-store/orders", "my-store.myshopify.com"],
    ["evil.com", null],
    ["my-store.myshopify.com.evil.com", null],
    ["", null],
  ])("normaliseShop(%j) = %j", (input, out) => expect(sh.normaliseShop(input)).toBe(out));

  test("OAuth callback HMAC matches Shopify's documented example", () => {
    const params = new URLSearchParams(
      "code=0907a61c0c8d55e99db179b68161bc00&hmac=700e2dadb827fcc8609e9d5ce208b2e9cdaab9df07390d2cbca10d7c328fc4bf&shop=some-shop.myshopify.com&state=0.6784241404160823&timestamp=1337178173",
    );
    expect(sh.verifyOAuthCallback(params, "hush")).toBe(true);
    params.set("shop", "other-shop.myshopify.com");
    expect(sh.verifyOAuthCallback(params, "hush")).toBe(false);
  });
  test("webhook HMAC: valid accepted, tampered body and wrong secret rejected", () => {
    const body = '{"id":1}';
    const sig = createHmac("sha256", "secret").update(body).digest("base64");
    expect(sh.verifyWebhook(body, sig, "secret")).toBe(true);
    expect(sh.verifyWebhook('{"id":2}', sig, "secret")).toBe(false);
    expect(sh.verifyWebhook(body, sig, "other")).toBe(false);
    expect(sh.verifyWebhook(body, null, "secret")).toBe(false);
  });
  test("asks for expiring offline tokens and read-only scopes", () => {
    expect(
      sh.codeExchangeBody({ clientId: "a", clientSecret: "b", code: "c" }).get("expiring"),
    ).toBe("1");
    const url = new URL(
      sh.authorizeUrl({
        shop: "x.myshopify.com",
        clientId: "id",
        redirectUri: "https://l.test/cb",
        state: "s",
      }),
    );
    expect(url.hostname).toBe("x.myshopify.com");
    expect(
      url.searchParams
        .get("scope")!
        .split(",")
        .every((s) => s.startsWith("read_")),
    ).toBe(true);
    expect(sh.missingScopes("read_products,read_inventory,read_locations,read_orders")).toEqual([]);
    expect(sh.missingScopes("read_products,write_inventory,read_locations")).toEqual([
      "read_orders",
    ]);
  });
  test("product and variant rows", () => {
    const rows = sh.productRows({
      id: "gid://shopify/Product/1",
      title: "Mug",
      status: "ACTIVE",
      vendor: null,
      productType: null,
      totalInventory: 7,
      updatedAt: "2026-11-01T00:00:00Z",
      featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/m.jpg" } } },
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/9",
            title: "Default Title",
            sku: "MUG",
            price: "149.90",
            inventoryQuantity: 7,
            inventoryItem: { id: "gid://shopify/InventoryItem/5", tracked: true },
          },
        ],
      },
    });
    expect(rows?.product).toMatchObject({
      id: "gid://shopify/Product/1",
      total_inventory: 7,
      image_url: "https://cdn.shopify.com/m.jpg",
    });
    expect(rows?.variants[0]).toMatchObject({
      price: 149.9,
      inventory_item_id: "gid://shopify/InventoryItem/5",
      tracked: true,
    });
    expect(sh.productRows({ id: "gid://shopify/Order/1" })).toBeNull();
  });
  test("order rows keep headers only, even when Shopify sends customer fields", () => {
    const row = sh.orderRow({
      id: "gid://shopify/Order/1",
      name: "#1001",
      createdAt: "2026-11-10T10:00:00Z",
      updatedAt: null,
      cancelledAt: null,
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "UNFULFILLED",
      currentTotalPriceSet: { shopMoney: { amount: "250.00", currencyCode: "ZAR" } },
      currentSubtotalLineItemsQuantity: 2,
      email: "buyer@example.com",
      customer: { firstName: "Bea" },
      shippingAddress: { address1: "1 Main Rd" },
    });
    expect(row).toEqual({
      id: "gid://shopify/Order/1",
      name: "#1001",
      shop_created_at: "2026-11-10T10:00:00Z",
      shop_updated_at: null,
      cancelled_at: null,
      financial_status: "PAID",
      fulfillment_status: "UNFULFILLED",
      total: 250,
      currency: "ZAR",
      item_count: 2,
    });
  });
  test("stock levels per location", () => {
    expect(
      sh.levelRows({
        id: "gid://shopify/InventoryItem/5",
        inventoryLevels: {
          nodes: [
            {
              location: { id: "gid://shopify/Location/1", name: "Shop" },
              quantities: [{ name: "available", quantity: 3 }],
            },
          ],
        },
      }),
    ).toEqual([
      {
        inventory_item_id: "gid://shopify/InventoryItem/5",
        location_id: "gid://shopify/Location/1",
        location_name: "Shop",
        available: 3,
      },
    ]);
  });
  test("webhook payload ids become GraphQL ids", () => {
    expect(
      sh.gid("Product", { id: 123, admin_graphql_api_id: "gid://shopify/Product/123" }, "id"),
    ).toBe("gid://shopify/Product/123");
    expect(sh.gid("Product", { id: 123 }, "id")).toBe("gid://shopify/Product/123");
    expect(sh.gid("InventoryItem", { inventory_item_id: 77 }, "inventory_item_id")).toBe(
      "gid://shopify/InventoryItem/77",
    );
    expect(sh.gid("Order", { id: "1; drop" }, "id")).toBeNull();
  });
  test("order search date is second-precision UTC", () => {
    expect(sh.ordersSearch(new Date("2026-09-01T10:20:30.456Z"))).toBe(
      "updated_at:>='2026-09-01T10:20:30Z'",
    );
  });
  test("throttling is recognised", () => {
    expect(
      sh.isThrottled({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }),
    ).toBe(true);
    expect(sh.isThrottled({ data: {} })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
const doc: AccountingDocument = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "invoice",
  number: "INV-0007",
  issueDate: "2026-11-01",
  dueDate: "2026-11-15",
  totalCents: 116725,
  status: "sent",
  sourceId: null,
  contact: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Thandi's Tiling",
    email: "t@example.co.za",
    phone: "+27821234567",
    vatNumber: null,
  },
  lines: [
    {
      description: "Tiling",
      quantity: 2,
      unitCents: 50000,
      discountPct: 5,
      vatRate: 15,
      netCents: 95000,
      vatCents: 14250,
      grossCents: 109250,
    },
    {
      description: "Grout",
      quantity: 1,
      unitCents: 7475,
      discountPct: 0,
      vatRate: 0,
      netCents: 7475,
      vatCents: 0,
      grossCents: 7475,
    },
  ],
};
const mapping = {
  salesAccount: "200",
  bankAccount: "bank-1",
  taxStandard: "OUTPUT",
  taxZero: "ZERORATEDOUTPUT",
};

describe("accounting mapping", () => {
  test("reads settings and names what is missing", () => {
    expect(readMapping({ sales_account: " 200 ", tax_standard: "OUTPUT" })).toEqual({
      salesAccount: "200",
      bankAccount: null,
      taxStandard: "OUTPUT",
      taxZero: null,
    });
    expect(mappingGaps(readMapping({}), { payments: true, zeroRated: true })).toEqual([
      "a sales account",
      "a VAT rate for 15% lines",
      "a VAT rate for 0% lines",
      "a bank account for payments",
    ]);
  });
});

describe("Xero", () => {
  test("asks only for granular scopes (apps created after 2 March 2026)", () => {
    const scope = new URL(
      xero.authorizeUrl({ clientId: "c", redirectUri: "https://l.test/cb", state: "s" }),
    ).searchParams.get("scope")!;
    expect(scope).toContain("offline_access");
    expect(scope).toContain("accounting.invoices");
    expect(scope).not.toContain("accounting.transactions");
  });
  test("invoice payload keeps Ledgerly's numbers and VAT per line", () => {
    const p = xero.documentPayload(doc, "contact-1", mapping) as {
      Invoices: Record<string, unknown>[];
    };
    const inv = p.Invoices[0]!;
    expect(inv).toMatchObject({
      Type: "ACCREC",
      InvoiceNumber: "INV-0007",
      Status: "AUTHORISED",
      LineAmountTypes: "Exclusive",
      DueDate: "2026-11-15",
    });
    expect(inv.LineItems).toEqual([
      {
        Description: "Tiling",
        Quantity: 2,
        UnitAmount: 500,
        DiscountRate: 5,
        AccountCode: "200",
        TaxType: "OUTPUT",
        TaxAmount: 142.5,
      },
      {
        Description: "Grout",
        Quantity: 1,
        UnitAmount: 74.75,
        AccountCode: "200",
        TaxType: "ZERORATEDOUTPUT",
        TaxAmount: 0,
      },
    ]);
  });
  test("credit notes and payments", () => {
    const cn = xero.documentPayload(
      { ...doc, kind: "credit_note", number: "CN-0001" },
      "c",
      mapping,
    ) as { CreditNotes: Record<string, unknown>[] };
    expect(cn.CreditNotes[0]).toMatchObject({ Type: "ACCRECCREDIT", CreditNoteNumber: "CN-0001" });
    expect(
      xero.paymentPayload(
        {
          id: "p",
          documentId: doc.id,
          method: "eft",
          amountCents: 50050,
          paidOn: "2026-11-03",
          reference: null,
        },
        "inv-1",
        mapping,
      ),
    ).toEqual({
      Payments: [
        {
          Invoice: { InvoiceID: "inv-1" },
          Account: { AccountID: "bank-1" },
          Date: "2026-11-03",
          Amount: 500.5,
          Reference: "Ledgerly eft",
        },
      ],
    });
  });
  test("picks the most recently authorised organisation", () => {
    expect(
      xero.pickTenant([
        {
          id: "a",
          tenantId: "t1",
          tenantType: "ORGANISATION",
          tenantName: "Old",
          updatedDateUtc: "2026-01-01T00:00:00",
        },
        {
          id: "b",
          tenantId: "t2",
          tenantType: "ORGANISATION",
          tenantName: "New",
          updatedDateUtc: "2026-11-12T10:00:00",
        },
        {
          id: "c",
          tenantId: "t3",
          tenantType: "PRACTICEMANAGER",
          updatedDateUtc: "2026-11-13T00:00:00",
        },
      ]),
    ).toEqual({ connectionId: "b", tenantId: "t2", name: "New" });
    expect(xero.pickTenant([])).toBeNull();
  });
  test("responses", () => {
    expect(
      xero.createdDocument(
        { Invoices: [{ InvoiceID: "x", InvoiceNumber: "INV-0007", Total: 1167.25 }] },
        "invoice",
      ),
    ).toEqual({ id: "x", number: "INV-0007", totalCents: 116725 });
    expect(xero.createdDocument({ Invoices: [] }, "invoice")).toBeNull();
    expect(
      xero.findContactByName(
        {
          Contacts: [
            { ContactID: "1", Name: "Thandi's Tiling (Pty)" },
            { ContactID: "2", Name: "thandi's tiling" },
          ],
        },
        "Thandi's Tiling",
      ),
    ).toBe("2");
    expect(
      xero.isDuplicateContactName({
        Elements: [
          {
            ValidationErrors: [
              { Message: "The contact name X is already assigned to another contact." },
            ],
          },
        ],
      }),
    ).toBe(true);
    expect(
      xero.salesAccounts({
        Accounts: [
          { AccountID: "a", Code: "200", Name: "Sales", Type: "REVENUE" },
          { AccountID: "b", Code: "090", Name: "Bank", Type: "BANK" },
        ],
      }),
    ).toEqual([{ value: "200", label: "200 · Sales" }]);
    expect(
      xero.bankAccounts({
        Accounts: [{ AccountID: "b", Code: "090", Name: "Bank", Type: "BANK" }],
      }),
    ).toEqual([{ value: "b", label: "090 · Bank" }]);
    expect(xero.idempotencyKey(["x".repeat(200)])).toHaveLength(128);
  });
});

describe("Sage Accounting (South Africa)", () => {
  test("URL carries the API key and company id; login goes in Basic auth", () => {
    const u = new URL(
      sage.sageUrl("TaxInvoice/Save", "{key}", "42", { useSystemDocumentNumber: "true" }),
    );
    expect(u.origin + u.pathname).toBe(
      "https://accounting.sageone.co.za/api/2.0.0/TaxInvoice/Save",
    );
    expect(u.searchParams.get("apikey")).toBe("{key}");
    expect(u.searchParams.get("companyid")).toBe("42");
    expect(sage.basicAuth("a@b.co", "p:w")).toBe(
      `Basic ${Buffer.from("a@b.co:p:w").toString("base64")}`,
    );
  });
  test("each line is one account line for its net amount, quantity 1", () => {
    const p = sage.documentPayload(doc, 40, {
      salesAccount: "7",
      bankAccount: "3",
      taxStandard: "1",
      taxZero: "2",
    });
    expect(p).toMatchObject({
      CustomerId: 40,
      Date: "2026-11-01",
      Reference: "INV-0007",
      Inclusive: false,
    });
    expect(p.Lines).toEqual([
      {
        SelectionId: 7,
        LineType: 1,
        TaxTypeId: 1,
        Description: "2 × Tiling (less 5%)",
        Quantity: 1,
        UnitPriceExclusive: 950,
      },
      {
        SelectionId: 7,
        LineType: 1,
        TaxTypeId: 2,
        Description: "Grout",
        Quantity: 1,
        UnitPriceExclusive: 74.75,
      },
    ]);
  });
  test("receipts", () => {
    expect(sage.paymentMethod("cash")).toBe(1);
    expect(sage.paymentMethod("yoco")).toBe(3);
    expect(sage.paymentMethod("eft")).toBe(4);
    expect(sage.paymentMethod("stitch")).toBe(4);
    expect(
      sage.receiptPayload(
        {
          id: "p",
          documentId: "d",
          method: "eft",
          amountCents: 10000,
          paidOn: "2026-11-02",
          reference: null,
        },
        40,
        { salesAccount: "7", bankAccount: "3", taxStandard: "1", taxZero: null },
        "INV-0007",
      ),
    ).toEqual({
      CustomerId: 40,
      Date: "2026-11-02",
      Total: 100,
      Reference: "INV-0007",
      Description: "Payment for INV-0007",
      BankAccountId: 3,
      PaymentMethod: 4,
    });
  });
  test("list and save responses", () => {
    expect(
      sage.companies({ TotalResults: 1, ReturnedResults: 1, Results: [{ ID: 5, Name: "Acme" }] }),
    ).toEqual([{ value: "5", label: "Acme" }]);
    expect(
      sage.taxTypes({
        Results: [
          { ID: 1, Name: "Standard", Percentage: 15 },
          { ID: 2, Name: "Old", Percentage: 14, Active: false },
        ],
      }),
    ).toEqual([{ value: "1", label: "Standard (15%)", rate: 15 }]);
    expect(sage.savedId({ ID: 40, Total: 1167.25, DocumentNumber: "INV0001" })).toEqual({
      id: "40",
      totalCents: 116725,
      number: "INV0001",
    });
    expect(sage.savedId({ Message: "error" })).toBeNull();
  });
});
