# Phase 3b — integrations (Courier Guy, Shopify, Stitch, Xero, Sage)

Written 2026-11-12 by Tiaan with Claude; built the same day on branch `feat/integrations` (see **Build status** at the end). Depends only on Phase 3 (payments, sales documents, outbox, jobs), so it runs alongside Phase 4. Global Constraints and Review Focus of `docs/plan.md` apply.

## 1. Scope and spec changes

Requested: accounting sync (Xero, Sage), Stitch payments, Courier Guy shipping, and a Shopify dashboard for products, orders and stock.

Spec lines this changes. Tiaan approved building all five; Greg should review the four changes below when merging.

| Spec | Today | Change |
|---|---|---|
| §1 owner decisions, §6.4, plan Global Constraints | Payment processors: Yoco and PayFast only | Add Stitch as a third provider |
| `docs/research.md` §3 (product stance) | "Not a general ledger; clean exports for the accountant" | Add one-way push of invoices, credit notes, payments and contacts to Xero and Sage SA. Still not a ledger |
| §14 out of scope | No inventory variants or locations | Shopify dashboard shows variants and per-location stock **read-only**. Ledgerly's own inventory (Phase 5.1) stays without them |
| §6 modules | No shipping module | New `shipments` table and "Ship this" action on invoices |

## 2. External facts

### Checked on 2026-11-12 (web search, not yet read from each provider's own docs)
- **Xero.** Tiered API pricing from 2 March 2026 replaced the 15% App Store revenue share. Pricing is by connected organisations and API egress, measured per app. Starter is free up to 5 connections. Journals and Practice Manager endpoints need the Advanced tier (about USD 895/month per a third-party summary). A Xero organisation can connect at most 2 uncertified apps. Source: developer.xero.com/pricing, developers.apideck.com/apis/accounting/xero/overview.
- **Sage South Africa** runs on a different codebase and API from the UK/IE/CA product. It uses Basic Authentication plus an API key, and needs an enrollment form and licence agreement. Source: developer.sage.com/accounting/guides/regional-considerations. Unified-API vendors (Apideck) list it as "on the radar", so there is no shortcut.
- **Shopify.** Admin GraphQL API; REST is legacy. New public apps must be GraphQL-only. Offline tokens must expire for public apps created on or after 1 April 2026; custom apps are exempt. Latest API version seen: 2026-04. Source: shopify.dev changelog.
- **Courier Guy** exposes the Ship Logic API (`api.shiplogic.com`: rates, pickup points, shipments). A Courier Guy account is needed to get a key. Source: thecourierguy.co.za/integrations, Zoho and Starshipit setup guides.
- **Stitch.** GraphQL at `api.stitch.money/graphql`, OAuth 2.0 client credentials. Products: pay by bank, Capitec Pay, cards, DebiCheck, EFT, payouts, bank account verification. Marketing is enterprise and contact-sales. Source: docs.stitch.money, apis.io.

### Must be read from the official docs before the matching task starts (record the result here, as Phase 3 did for PayFast)
- Xero: OAuth2 flow and scopes for apps created after the March 2026 changes; refresh-token lifetime and rotation; `Idempotency-Key` support; ZA tax type codes; rate limits.
- Sage SA: exact credential model (does it need the user's own username and password?), endpoints for Customer, SalesInvoice, CustomerReceipt, tax type ids, webhooks (none assumed).
- Shopify: Dev Dashboard app creation steps for a single store; whether custom distribution suits one app installed on many unrelated stores; webhook HMAC header and secret; bulk-operation limits; how far back `read_orders` reaches without `read_all_orders`.
- Courier Guy: request bodies for rates and shipments, label/waybill download, tracking endpoint or webhook, sandbox URL, required address fields.
- Stitch: onboarding requirements and fees for a small business.

## 3. Design rulings

1. **Two connection tables.** Payments stay in `payment_connections` (Stitch joins Yoco and PayFast there). Everything else goes in a new `integration_connections`. Both keep secrets in Vault and store only Vault ids.
2. **Who owns the app registration differs per provider.**
   - Courier Guy, Stitch, Sage SA: the business pastes its own credentials, like Yoco and PayFast.
   - Xero: OAuth needs one ASC-owned Xero app. `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` are environment variables. Each workspace stores only its tokens and tenant id. Every connected workspace counts as a Xero connection against ASC's tier.
   - Shopify: one ASC-owned app, authorization code grant with expiring offline tokens (`expiring=1`), `SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET`. (The paste model is gone: Shopify no longer lets merchants create legacy custom apps, and the client credentials grant only works for stores in ASC's own Shopify organisation.) A store is saved only by `connect_shopify()` (service role) after the callback's HMAC and state check, so nobody can claim another merchant's store address.
3. **Rotating OAuth tokens.** Xero and Shopify refresh tokens rotate on use, so two workers refreshing at once would lock the connection out. An advisory lock cannot span the HTTP call (each PostgREST call is its own transaction), so refresh uses a 60-second lease: `claim_token_refresh()` sets `refresh_lease_until`; only the holder calls the provider; `store_integration_tokens()` saves the new pair and clears the lease; other workers wait for the new token.
4. **Accounting sync is one-way, asynchronous and never blocks sending.** Ledgerly stays the source of truth for numbers and amounts. Events enqueue jobs in `integration_jobs`; a worker pushes them. `sync_links` makes every push idempotent. A failed push shows in the UI with a retry button and never blocks an invoice.
5. **Scheduled work reuses the Phase 3 pattern**: `pg_cron` + `pg_net` call `/api/jobs/<job>` with `JOBS_SECRET`; the job claims rows with `for update skip locked`.
6. **Webhooks.** Courier Guy and Stitch URLs carry the connection id (`/api/webhooks/stitch/<id>`). Shopify's HMAC secret belongs to the app, so its handler finds the connection from the `X-Shopify-Shop-Domain` header, then verifies. All events are stored unique on `(provider, event_id)` and applied once. Verified but irrelevant events get 200.
7. **Shopify data is minimal.** Orders carry customer personal information (POPIA). The dashboard caches order headers only (number, date, totals, payment and fulfilment status, line counts) and links to Shopify for customer detail. No customer email, phone or address is stored.
8. **Addresses.** `contacts.address` is one free-text field (max 500). Courier Guy needs structured addresses, so each shipment stores its own structured collection and delivery address, prefilled from the contact. The contacts schema is not changed.
9. **Service-role boundary.** New webhook handlers live under `src/app/api/webhooks/**`, already allowed. The integrations job route is added to the allow-list in `eslint.config.mjs` (lines 10 and 30) by name. The rule is not loosened.
10. **UI home:** `/[ws]/settings/integrations`, owner and admin only, next to the existing payments page. Shopify dashboard at `/[ws]/shop`, enabled by a new `workspace_modules` key `shop`.

## 4. Data model (new migrations, each with a down script)

Numbered 0050+ so they cannot collide with Phases 4–7. If this merges before those phases, renumber to the next free number so Supabase applies them in order.

| Migration | Contents |
|---|---|
| `0050_integrations` | `integration_connections` (workspace_id, provider in xero/sage/shopify/courier_guy, status, external_id such as Xero tenant id or shop domain, mode, Vault ids, token_expires_at, last_sync_at, last_error), `integration_events` (unique provider+event_id), `integration_jobs` (kind, entity, attempts, next_attempt_at, status, last_error), `sync_links` (unique workspace, provider, entity_type, local_id; external_id, payload_hash, synced_at). RPCs: `connect_integration`, `integration_connection_secrets`, `integration_store_tokens`, `disconnect_integration`, `claim_integration_jobs`. RLS: members read status only; owner/admin manage; secrets only through security-definer RPCs |
| `0051_stitch` | Widen the `('yoco','payfast')` checks on `payment_connections`, `payment_checkouts`, `payment_events`, `payments.method`; update `app.apply_payment`, `connect_payment_provider`, `apply_payment_event`; add `payment_connections.client_id` (the existing `merchant_id` regex only fits digits) |
| `0052_shipments` | `shipments` (document_id nullable, connection_id, structured addresses, parcels jsonb, service_code, quoted_cents, provider_shipment_id, tracking_ref, label_path, status), `shipment_events` (unique provider+event_id) |
| `0053_shopify` | `shopify_products`, `shopify_variants`, `shopify_inventory_levels` (per location), `shopify_orders` (headers only), `shopify_sync_state`. Members read; only the service role writes |
| `0054_accounting_sync` | Triggers queue a push when an invoice or credit note is sent or voided and when a payment is recorded; `queue_accounting_push()` for "Send now" |
| `0055_integration_schedule` | Extend `app.call_job` with `integrations`, `shopify-sync`, `shipment-tracking`; schedule them |

## 5. Tasks (each: tests first, then code, then commit; `npm run check` before every commit)

Order: nothing needing approval first, then the providers that need an application.

| Task | Deliverable | Produces | Tests |
|---|---|---|---|
| I.0 Foundations | Migration 0050, Vault-backed RPCs, jobs route and schedule, integrations settings page, fake-provider test helper | `src/server/integrations/{connections,run-jobs,http,job-types}.ts`; `requestJson` with timeout and `Retry-After`; the queue does the retrying | Workspace A cannot read B's connection or secrets; job claimed by one worker only; backoff schedule; secrets never returned to the browser |
| I.1 Courier Guy | Connect (paste API key), rate quote and book on an invoice, waybill/label download, tracking updates on the invoice timeline | `src/server/integrations/courier-guy.ts`; `courier-guy-service.ts` (`quote`, `book`, `waybill`, `track`); migration 0052 | Request bodies match recorded sandbox fixtures; booking twice with the same request id creates one shipment; rate failure leaves the invoice usable; address validation errors name the field |
| I.2 Shopify dashboard | Connect, initial bulk sync, webhook updates, pages for Products, Orders, Stock (per location), low-stock list, sales by day | `src/server/integrations/shopify.ts`, `shopify-service.ts`; migration 0053; `/[ws]/shop` | HMAC accepts valid, rejects tampered and wrong secret; replayed webhook applies once; initial sync resumes after a failure; no customer contact fields stored; GraphQL cost throttle respected |
| I.3 Stitch | Third payment provider: connect, hosted pay-by-bank/card checkout on the public invoice, webhook, refunds not included | `src/server/payments/stitch.ts`; migration 0051; `/api/webhooks/stitch/[connection]` | Same matrix as Yoco: valid signature accepted; tampered, wrong secret, stale timestamp rejected; replay applies once; part payment sets `part_paid`; token refresh on expiry |
| I.4 Xero | OAuth connect, account/tax/bank mapping screen, push of contacts, invoices, credit notes and payments | `src/server/integrations/xero.ts`; mapping stored in connection settings | Concurrent refresh yields one valid token pair; invoice pushed twice is one Xero invoice; Ledgerly totals equal Xero totals or the push is flagged; voided invoice handled; 429 backs off; disconnect revokes |
| I.5 Sage SA | Connect, same push as Xero through the same adapter interface | `src/server/integrations/sage-za.ts` | Same matrix as Xero minus OAuth; credentials never logged |

Adapter interface for I.4 and I.5: `interface AccountingProvider { upsertContact(c): Promise<ExternalRef>; upsertInvoice(d): Promise<ExternalRef>; upsertCreditNote(d): Promise<ExternalRef>; recordPayment(p): Promise<ExternalRef> }`.

## 6. Review focus

- **Xero cost scales with customers.** One connection per connected workspace. Above 5 customers on Xero, ASC pays a tier. Price the Pro plan with that in mind, or limit Xero to Pro.
- **Sage SA Basic auth.** If the API needs the user's own Sage username and password, Ledgerly would hold a third party's login. Decide whether that is acceptable before I.5, and say so on the connect screen.
- **Stitch onboarding.** It may require a contract per business. If so, offer it only where a business already has Stitch, and keep Yoco/PayFast as the default.
- **Rounding.** Ledgerly stores cents; Xero and Sage recalculate VAT per line. A mismatch of a cent must be flagged, not silently adjusted.
- **POPIA.** The privacy policy (Phase 7) must name Shopify, Xero, Sage, Courier Guy and Stitch as operators and say what is sent to each.
- **Provider drift.** Xero changed its terms in 2026 and Shopify bumps its API every quarter. Pin the Shopify version in code and calendar a bump every 3 months.
- **Hosting limits.** Initial Shopify and Xero syncs can outlast a serverless request; they run as resumable job batches, never in one request.

## 7. Needs from owner

- Greg: approval of the four spec changes in section 1.
- Courier Guy business account and a sandbox key.
- Shopify development store and a Dev Dashboard app.
- Xero developer app (Starter tier) and a demo company.
- Sage Business Cloud Accounting (South Africa) trial company, enrollment form and API key.
- Stitch sandbox client id and secret; a Stitch sales conversation on onboarding terms.

## 8. Build status (2026-11-12)

Built on `feat/integrations`. `npm run check` passes (381 unit tests, 72 of them new), `next build` passes, and every migration plus all SQL suites run green on a local Postgres 16 with Supabase stubs (`INTEGRATIONS TESTS: 63 passed, 0 failed`; Greg's suites unchanged). Nothing has been run against a real provider yet: there were no sandbox credentials.

### Verified from each provider's own docs before coding
- **Xero:** login/identity URLs, Basic-auth token exchange, 30-minute access tokens, rotating refresh tokens (60 days, 30-minute retry grace), `GET /connections` for the tenant, granular scopes only for apps created after 2 March 2026.
- **Shopify:** authorization code grant; `expiring=1` gives 1-hour access and 90-day rotating refresh tokens; OAuth callback HMAC (Shopify's own example vector is a unit test); webhook headers and base64 HMAC with the client secret; `webhookSubscriptionCreate(topic, webhookSubscription: { uri })`; latest API version `2026-10` (pinned).
- **Stitch:** token at `secure.stitch.money/connect/token` (client credentials, scope `client_paymentrequest`, audience = token URL); REST `POST /v2/payment-requests` → `interaction.url`; `GET /v2/payment-requests/{id}` statuses `completed|pending|cancelled|expired`; `redirect_uri` / `failure_redirect_uri` appended to the payer URL; Svix-signed webhooks (same check as Yoco); `payment` webhook payload shape.
- **Sage SA:** `https://accounting.sageone.co.za/api/2.0.0/<Service>/<Method>?apikey=…&companyid=…` with Basic auth of the user's own login; 5 000 requests/day per company, a 429 blocks the user for 24 hours; `Customer/Save`, `TaxInvoice/Save`, `CustomerReturn/Save`, `CustomerReceipt/Save` fields; line type Account = 1 (quantity must be 1); payment methods Cash 1, Cheque 2, CreditCard 3, EFT 4.
- **Courier Guy:** Ship Logic, bearer API key, `POST /rates`, `POST /shipments`, address/contact/parcel field names, sandbox at tcg-sandbox.shiplogic.com.

### Check in each sandbox before go-live (code is tolerant here, but unconfirmed)
- **Courier Guy:** exact response shapes of `/rates`, `/shipments`, `/shipments/label?id=` and `/tracking/shipments?tracking_reference=`; whether production is `api.shiplogic.com` or `api.portal.thecourierguy.co.za` (the base URL is a per-connection setting limited to those two domains); the full list of status slugs (`mapStatus`).
- **Xero:** `Idempotency-Key` behaviour on a retried failed request (the key includes a hash of the body, so a corrected request gets a new key); `TaxAmount` override on line items matching Ledgerly's VAT to the cent; `Contacts?searchTerm=` for duplicate names.
- **Shopify:** refresh request body (`grant_type=refresh_token`, `refresh_token`, client id/secret, form-encoded); GraphQL query costs at real catalogue sizes; whether ASC's app needs public distribution to install on merchants' stores.
- **Stitch:** whether a payment request needs a `beneficiary` when the client has a default beneficiary configured; the `clientWebhookAdd` mutation (not automated: the business adds the webhook in Stitch and pastes the `whsec_` secret).
- **Sage:** whether `TaxInvoice/Save` accepts `useSystemDocumentNumber=true` with our number in `Reference`; list endpoints' paging past 100 results (`Account/Get`, `TaxType/Get`).

### Known limits
- Only documents sent after an accounting app is connected are pushed; older ones use **Send now** on the document.
- Sage SA's API has no void and no receipt allocation: Ledgerly flags voids for the person to do in Sage, and receipts land unallocated.
- Shopify orders only reach back 60 days (no `read_all_orders`); variants beyond 30 per product are not cached.
- Stitch requests Pay by Bank only; card and Capitec Pay need Stitch to enable them on the client first.
- `src/lib/security/csp.ts` has `form-action 'self'`, which also blocks the existing PayFast form POST to payfast.co.za on the public invoice page. Not changed here (Phase 3 code); needs `https://www.payfast.co.za https://sandbox.payfast.co.za` in `form-action`.

